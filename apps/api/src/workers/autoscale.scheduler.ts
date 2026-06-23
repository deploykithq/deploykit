import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { applications, auditLogs } from "../db/schema/index";
import { getDockerForServer } from "../services/docker-factory";

// How often we evaluate every autoscaling app.
const POLL_INTERVAL_MS = 30_000;

// Anti-flapping: scale UP after a short sustained breach, scale DOWN only after
// a much longer calm period, and stay quiet for `autoscaleCooldown` after any
// action. Scale-down also requires utilization to fall well below target.
const SCALE_UP_STABILIZATION_MS = 60_000; // 1 min sustained above target
const SCALE_DOWN_STABILIZATION_MS = 300_000; // 5 min sustained low
const SCALE_DOWN_FACTOR = 0.5; // only shed a replica when util < target × 0.5

interface AppState {
  highSince: number | null; // first tick utilization crossed above target
  lowSince: number | null; // first tick utilization dropped into the scale-down band
  lastActionAt: number; // last scale action (epoch ms) — drives cooldown
}

// In-memory; lost on restart (the windows simply re-stabilize). No persistence
// needed since decisions are derived from live stats each tick.
const state = new Map<string, AppState>();

/**
 * Average CPU/memory utilization across an app's running replicas.
 *  - memory: docker already reports `% of the container's limit`.
 *  - cpu: `getStats().cpu` is percent-of-one-core (100 = a full core). We turn
 *    that into `% of allocation`: divided by the CPU limit's cores when a limit
 *    is set, otherwise treated directly as % of a single core.
 */
async function sampleUtilization(
  docker: Awaited<ReturnType<typeof getDockerForServer>>["docker"],
  serviceId: string,
  cpuLimitMillicores: number | null,
): Promise<{ avgCpu: number; avgMem: number; running: number } | null> {
  const containers = await docker.listServiceContainers(serviceId);
  const running = containers.filter((c) => c.state === "running");
  if (running.length === 0) return null;

  let cpuSum = 0;
  let memSum = 0;
  let n = 0;
  for (const c of running) {
    const stats = await docker.getStats(c.id);
    if (!stats) continue;
    const cpuUtil = cpuLimitMillicores
      ? stats.cpu / (cpuLimitMillicores / 1000)
      : stats.cpu;
    cpuSum += cpuUtil;
    memSum += stats.memory.percent;
    n++;
  }
  if (n === 0) return null;
  return { avgCpu: cpuSum / n, avgMem: memSum / n, running: running.length };
}

async function evaluate(app: typeof applications.$inferSelect & {
  domains: unknown[];
}): Promise<void> {
  // Replicas ride Traefik load balancing, which only exists when the app has a
  // domain. No domain → nothing to scale.
  if (!app.domains || app.domains.length === 0) return;

  const { docker, isRemote } = await getDockerForServer(app.serverId);
  // Live, rebuild-free scaling is local-only for now (see remote stub).
  if (isRemote) return;

  const min = Math.max(1, app.autoscaleMin);
  const max = Math.max(min, app.autoscaleMax);
  const cpuTarget = app.autoscaleCpuTarget;
  const memTarget = app.autoscaleMemTarget;
  // Nothing to act on if neither metric is configured.
  if (cpuTarget == null && memTarget == null) return;

  const sample = await sampleUtilization(docker, app.id, app.cpuLimit);
  if (!sample) return;
  const { avgCpu, avgMem, running: current } = sample;

  const now = Date.now();
  const st = state.get(app.id) ?? {
    highSince: null,
    lowSince: null,
    lastActionAt: 0,
  };

  const above =
    (cpuTarget != null && avgCpu > cpuTarget) ||
    (memTarget != null && avgMem > memTarget);
  // Below the scale-down band on every configured metric.
  const below =
    (cpuTarget == null || avgCpu < cpuTarget * SCALE_DOWN_FACTOR) &&
    (memTarget == null || avgMem < memTarget * SCALE_DOWN_FACTOR);

  st.highSince = above ? (st.highSince ?? now) : null;
  st.lowSince = below ? (st.lowSince ?? now) : null;

  const inCooldown = now - st.lastActionAt < (app.autoscaleCooldown ?? 180) * 1000;

  let target = current;
  if (
    !inCooldown &&
    above &&
    current < max &&
    st.highSince != null &&
    now - st.highSince >= SCALE_UP_STABILIZATION_MS
  ) {
    target = current + 1;
  } else if (
    !inCooldown &&
    below &&
    current > min &&
    st.lowSince != null &&
    now - st.lowSince >= SCALE_DOWN_STABILIZATION_MS
  ) {
    target = current - 1;
  }

  // Hard bounds win regardless of cooldown/stabilization (e.g. a lowered max).
  target = Math.min(max, Math.max(min, target));

  if (target !== current) {
    try {
      await docker.scaleService(app.id, target);
      await db
        .update(applications)
        .set({ replicas: target, updatedAt: new Date() })
        .where(eq(applications.id, app.id));

      const direction = target > current ? "up" : "down";
      console.log(
        `[autoscaler] ${app.name}: ${current} → ${target} replicas ` +
          `(cpu ${avgCpu.toFixed(0)}%, mem ${avgMem.toFixed(0)}%)`,
      );
      await db.insert(auditLogs).values({
        userEmail: "system@autoscaler",
        action: "application.autoscale",
        resourceType: "application",
        resourceId: app.id,
        resourceName: app.name,
        metadata: {
          direction,
          from: current,
          to: target,
          avgCpu: Math.round(avgCpu),
          avgMem: Math.round(avgMem),
          cpuTarget,
          memTarget,
        },
      });

      st.lastActionAt = now;
      st.highSince = null;
      st.lowSince = null;
    } catch (err: any) {
      console.error(`[autoscaler] scale failed for ${app.name}:`, err.message);
    }
  }

  state.set(app.id, st);
}

async function tick(): Promise<void> {
  try {
    const apps = await db.query.applications.findMany({
      where: and(
        eq(applications.autoscaleEnabled, true),
        eq(applications.status, "running"),
      ),
      with: { domains: true },
    });
    await Promise.allSettled(apps.map((a) => evaluate(a as any)));
  } catch (err: any) {
    console.error("[autoscaler] tick error:", err.message);
  }
}

export function startAutoscaleScheduler(): NodeJS.Timeout {
  // First pass after 15s so the deploy/metrics machinery is warm.
  setTimeout(() => tick(), 15_000);
  const interval = setInterval(() => tick(), POLL_INTERVAL_MS);
  console.log(
    `[autoscaler] Started (evaluating every ${POLL_INTERVAL_MS / 1000}s)`,
  );
  return interval;
}
