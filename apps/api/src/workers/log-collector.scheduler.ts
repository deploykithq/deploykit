import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { applications, databases, composeServices } from "../db/schema/index";
import { DockerService } from "../services/docker";
import {
  ensureLogStream,
  stopLogStream,
  activeStreamIds,
  flushLogBuffer,
} from "../services/logs";

/**
 * Continuous log collector.
 *
 * Keeps one follow-stream open for every running container so runtime logs are
 * captured into container_logs even when nobody is watching the UI. Mirrors the
 * enumerate-running-containers pattern of metrics.scheduler.ts.
 *
 * Local-first: uses the local Docker daemon (like metrics/autoscale); remote SSH
 * servers are best-effort/future.
 */

const TICK_INTERVAL_MS = 15_000;
const FLUSH_INTERVAL_MS = 2_000;

const localDocker = new DockerService();

type ServiceTypeT = "application" | "database" | "compose";

async function tick(): Promise<void> {
  try {
    const [apps, dbs, stacks] = await Promise.all([
      db.query.applications.findMany({
        where: eq(applications.status, "running"),
        columns: { id: true, containerId: true },
      }),
      db.query.databases.findMany({
        where: eq(databases.status, "running"),
        columns: { id: true, containerId: true },
      }),
      db.query.composeServices.findMany({
        where: eq(composeServices.status, "running"),
        columns: { id: true },
      }),
    ]);

    const running = new Map<string, { id: string; type: ServiceTypeT }>();
    for (const app of apps) {
      if (app.containerId) running.set(app.containerId, { id: app.id, type: "application" });
    }
    for (const d of dbs) {
      if (d.containerId) running.set(d.containerId, { id: d.id, type: "database" });
    }

    // A stack stores no container ids — it owns several, and Compose recreates
    // them freely. They are found by the label the transformer injects, so the
    // set stays correct across recreations without any bookkeeping here.
    for (const stack of stacks) {
      let containers: Array<{ id: string; state: string }>;
      try {
        containers = await localDocker.listServiceContainers(stack.id);
      } catch {
        continue; // Remote stacks and transient daemon errors: skip this tick.
      }
      for (const container of containers) {
        if (container.state === "running") {
          running.set(container.id, { id: stack.id, type: "compose" });
        }
      }
    }

    // Ensure a persisting stream for every running container.
    await Promise.allSettled(
      [...running.entries()].map(([containerId, svc]) =>
        ensureLogStream(containerId, { serviceId: svc.id, serviceType: svc.type }),
      ),
    );

    // Reconcile: stop streams for containers no longer running.
    for (const containerId of activeStreamIds()) {
      if (!running.has(containerId)) stopLogStream(containerId);
    }
  } catch (err: any) {
    console.error("[log-collector] tick error:", err.message);
  }
}

export function startLogCollector(): NodeJS.Timeout {
  // First tick after 8s to let the app and Docker settle.
  setTimeout(() => tick(), 8_000);
  setInterval(() => {
    flushLogBuffer().catch((err) =>
      console.error("[log-collector] flush error:", err.message),
    );
  }, FLUSH_INTERVAL_MS);

  const interval = setInterval(() => tick(), TICK_INTERVAL_MS);
  console.log(
    `[log-collector] Started (reconcile every ${TICK_INTERVAL_MS / 1000}s, flush every ${FLUSH_INTERVAL_MS / 1000}s)`,
  );
  return interval;
}
