import { eq, and, isNull } from "drizzle-orm";
import { docker } from "../lib/docker";
import { db } from "../db/index";
import {
  applications,
  databases,
  composeServices,
  alertRules,
  alertEvents,
} from "../db/schema/index";
import {
  storeSample,
  pushPending,
  parseDockerStats,
  getDiskUsage,
  type ServiceTypeT,
} from "../services/metrics";
import { DockerService } from "../services/docker";
import { notify } from "../services/notifier";
import { getIO } from "../lib/socket";
import { redis } from "../lib/redis";

const POLL_INTERVAL_MS = 30_000;

const localDocker = new DockerService();

// Key: `alert:cooldown:{ruleId}`  → 1  (TTL = cooldownMinutes)
// Prevents spamming notifications during sustained high usage.
const cooldownKey = (ruleId: string) => `alert:cooldown:${ruleId}`;

async function isCoolingDown(ruleId: string): Promise<boolean> {
  const val = await redis.get(cooldownKey(ruleId));
  return val !== null;
}

async function setCooldown(ruleId: string, minutes: number): Promise<void> {
  await redis.set(cooldownKey(ruleId), "1", "EX", minutes * 60);
}

function getMetricValue(
  sample: ReturnType<typeof parseDockerStats>,
  metric: string,
): number {
  switch (metric) {
    case "cpu":
      return sample.cpu;
    case "memory":
      return sample.memPercent;
    case "net_rx":
      return sample.netRx;
    case "net_tx":
      return sample.netTx;
    default:
      return 0;
  }
}

function metricLabel(metric: string): string {
  switch (metric) {
    case "cpu":
      return "CPU";
    case "memory":
      return "Memory";
    case "net_rx":
      return "Network RX";
    case "net_tx":
      return "Network TX";
    default:
      return metric;
  }
}

async function checkRules(
  serviceId: string,
  serviceType: ServiceTypeT,
  serviceName: string,
  sample: ReturnType<typeof parseDockerStats>,
): Promise<void> {
  const rules = await db.query.alertRules.findMany({
    where: and(
      eq(alertRules.serviceId, serviceId),
      eq(alertRules.enabled, true),
    ),
  });

  for (const rule of rules) {
    const value = getMetricValue(sample, rule.metric);
    const breached =
      rule.operator === "gt" ? value > rule.threshold : value < rule.threshold;

    if (!breached) {
      // If there's an open (unresolved) event for this rule, resolve it
      const openEvent = await db.query.alertEvents.findFirst({
        where: and(
          eq(alertEvents.ruleId, rule.id),
          isNull(alertEvents.resolvedAt),
        ),
      });
      if (openEvent) {
        await db
          .update(alertEvents)
          .set({ resolvedAt: new Date() })
          .where(eq(alertEvents.id, openEvent.id));

        try {
          getIO().emit("alert:resolved", {
            eventId: openEvent.id,
            serviceId,
            metric: rule.metric,
          });
        } catch {
          /* socket not ready */
        }
      }
      continue;
    }

    // Breached — check cooldown before firing again
    if (await isCoolingDown(rule.id)) continue;

    const opLabel = rule.operator === "gt" ? ">" : "<";
    const message = `${metricLabel(rule.metric)} on "${serviceName}" is ${value.toFixed(1)} (threshold ${opLabel} ${rule.threshold})`;

    // Insert event
    const [event] = await db
      .insert(alertEvents)
      .values({
        ruleId: rule.id,
        serviceType,
        serviceId,
        serviceName,
        metric: rule.metric,
        value,
        message,
      })
      .returning();

    // Set cooldown
    await setCooldown(rule.id, rule.cooldownMinutes);

    // Send notification
    await notify(rule.channel, rule.channelConfig, {
      ruleId: rule.id,
      eventId: event!.id,
      serviceName,
      serviceType,
      metric: rule.metric,
      value,
      threshold: rule.threshold,
      operator: rule.operator,
      message,
    }).catch((err) => {
      console.error(
        `[metrics-scheduler] Notification failed for rule ${rule.id}:`,
        err.message,
      );
    });
  }
}

async function pollContainer(
  containerId: string,
  serviceId: string,
  serviceType: ServiceTypeT,
  serviceName: string,
  diskUsed: number,
): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    const raw = (await container.stats({ stream: false })) as any;
    const parsed = parseDockerStats(raw);
    const sample = { ts: Date.now(), ...parsed, diskUsed };

    await storeSample(serviceId, sample);
    // Buffer for the rollup scheduler to persist into long-term history.
    await pushPending(serviceId, sample);

    // Emit live metrics update to subscribed frontend clients
    try {
      getIO()
        .to(`metrics:${serviceId}`)
        .emit("metrics:update", {
          serviceId,
          serviceType,
          serviceName,
          ...sample,
        });
    } catch {
      /* socket not ready */
    }

    await checkRules(serviceId, serviceType, serviceName, parsed);
  } catch (err: any) {
    // Container may be stopped — not an error worth logging noisily
    if (
      !err.message?.includes("No such container") &&
      !err.message?.includes("not running")
    ) {
      console.error(
        `[metrics-scheduler] pollContainer ${containerId}:`,
        err.message,
      );
    }
  }
}

/**
 * Sample every container of a Compose stack and store the total as one row.
 *
 * `metric_samples` is unique on (service_id, resolution, bucket), so a stack
 * has to reduce to a single series — and a stack-level total is what the
 * Monitoring tab wants anyway. CPU, memory and network are summed; the
 * per-container breakdown stays in the live Socket.IO payload.
 */
async function pollComposeStack(
  stackId: string,
  stackName: string,
  diskUsed: number,
): Promise<void> {
  try {
    const containers = await localDocker.listServiceContainers(stackId);
    const running = containers.filter((c) => c.state === "running");
    if (running.length === 0) return;

    const perContainer: Array<{
      name: string;
      stats: ReturnType<typeof parseDockerStats>;
    }> = [];

    for (const c of running) {
      try {
        const raw = (await docker
          .getContainer(c.id)
          .stats({ stream: false })) as any;
        perContainer.push({ name: c.name, stats: parseDockerStats(raw) });
      } catch {
        // A container recreated mid-tick just misses this sample.
      }
    }
    if (perContainer.length === 0) return;

    const total = perContainer.reduce(
      (acc, { stats }) => ({
        cpu: acc.cpu + stats.cpu,
        memUsed: acc.memUsed + stats.memUsed,
        memTotal: acc.memTotal + stats.memTotal,
        netRx: acc.netRx + stats.netRx,
        netTx: acc.netTx + stats.netTx,
      }),
      { cpu: 0, memUsed: 0, memTotal: 0, netRx: 0, netTx: 0 },
    );

    const parsed = {
      cpu: Math.round(total.cpu * 100) / 100,
      memUsed: total.memUsed,
      memTotal: total.memTotal,
      memPercent:
        total.memTotal > 0
          ? Math.round((total.memUsed / total.memTotal) * 10000) / 100
          : 0,
      netRx: total.netRx,
      netTx: total.netTx,
    };
    const sample = { ts: Date.now(), ...parsed, diskUsed };

    await storeSample(stackId, sample);
    await pushPending(stackId, sample);

    try {
      getIO()
        .to(`metrics:${stackId}`)
        .emit("metrics:update", {
          serviceId: stackId,
          serviceType: "compose",
          serviceName: stackName,
          ...sample,
          containers: perContainer.map(({ name, stats }) => ({
            name,
            cpu: stats.cpu,
            memUsed: stats.memUsed,
            memPercent: stats.memPercent,
          })),
        });
    } catch {
      /* socket not ready */
    }

    await checkRules(stackId, "compose", stackName, parsed);
  } catch (err: any) {
    console.error(`[metrics-scheduler] pollComposeStack ${stackId}:`, err.message);
  }
}

async function tick(): Promise<void> {
  try {
    const [apps, dbs, stacks] = await Promise.all([
      db.query.applications.findMany({
        where: eq(applications.status, "running"),
        columns: { id: true, name: true, containerId: true },
      }),
      db.query.databases.findMany({
        where: eq(databases.status, "running"),
        columns: { id: true, name: true, containerId: true },
      }),
      db.query.composeServices.findMany({
        where: eq(composeServices.status, "running"),
        columns: { id: true, name: true },
      }),
    ]);

    // One Redis round-trip for the whole tick; the disk scheduler refreshes
    // these keys every 5 minutes.
    const diskById = await getDiskUsage([
      ...apps.map((a) => a.id),
      ...dbs.map((d) => d.id),
      ...stacks.map((s) => s.id),
    ]);

    const tasks: Promise<void>[] = [];

    for (const app of apps) {
      if (app.containerId) {
        tasks.push(
          pollContainer(
            app.containerId,
            app.id,
            "application",
            app.name,
            diskById.get(app.id) ?? 0,
          ),
        );
      }
    }

    for (const db_ of dbs) {
      if (db_.containerId) {
        tasks.push(
          pollContainer(
            db_.containerId,
            db_.id,
            "database",
            db_.name,
            diskById.get(db_.id) ?? 0,
          ),
        );
      }
    }

    for (const stack of stacks) {
      tasks.push(
        pollComposeStack(stack.id, stack.name, diskById.get(stack.id) ?? 0),
      );
    }

    // Concurrent but isolated — one failure doesn't block others
    await Promise.allSettled(tasks);
  } catch (err: any) {
    console.error("[metrics-scheduler] tick error:", err.message);
  }
}

export function startMetricsScheduler(): NodeJS.Timeout {
  // First tick after 5s to let the app fully start
  setTimeout(() => tick(), 5_000);

  const interval = setInterval(() => tick(), POLL_INTERVAL_MS);
  console.log(
    `[metrics-scheduler] Started (polling every ${POLL_INTERVAL_MS / 1000}s)`,
  );
  return interval;
}
