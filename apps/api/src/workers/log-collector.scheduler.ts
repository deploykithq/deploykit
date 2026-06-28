import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { applications, databases } from "../db/schema/index";
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

async function tick(): Promise<void> {
  try {
    const [apps, dbs] = await Promise.all([
      db.query.applications.findMany({
        where: eq(applications.status, "running"),
        columns: { id: true, containerId: true },
      }),
      db.query.databases.findMany({
        where: eq(databases.status, "running"),
        columns: { id: true, containerId: true },
      }),
    ]);

    const running = new Map<string, { id: string; type: "application" | "database" }>();
    for (const app of apps) {
      if (app.containerId) running.set(app.containerId, { id: app.id, type: "application" });
    }
    for (const d of dbs) {
      if (d.containerId) running.set(d.containerId, { id: d.id, type: "database" });
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
