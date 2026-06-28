import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { redis } from "../lib/redis";

/**
 * Prunes container_logs past their retention window. Mirrors the prune half of
 * metrics-rollup.scheduler.ts: runs every 6h, gated by a Redis NX lock so it
 * fires at most once across restarts/processes.
 */

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const CLEANUP_LOCK_KEY = "logs:cleanup:lock";
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 7;

async function pruneOldLogs(): Promise<void> {
  const acquired = await redis.set(CLEANUP_LOCK_KEY, "1", "EX", 6 * 3600, "NX");
  if (acquired !== "OK") return;

  try {
    await db.execute(sql`
      DELETE FROM container_logs
      WHERE created_at < now() - make_interval(days => ${LOG_RETENTION_DAYS})
    `);
  } catch (err: any) {
    console.error("[log-cleanup] prune error:", err.message);
  }
}

export function startLogCleanupScheduler(): NodeJS.Timeout {
  // First run after 90s so startup isn't competing with migrations/collector.
  setTimeout(() => pruneOldLogs(), 90_000);

  const interval = setInterval(() => pruneOldLogs(), CLEANUP_INTERVAL_MS);
  console.log(
    `[log-cleanup] Started (prune every ${CLEANUP_INTERVAL_MS / 1000 / 3600}h, retention ${LOG_RETENTION_DAYS}d)`,
  );
  return interval;
}
