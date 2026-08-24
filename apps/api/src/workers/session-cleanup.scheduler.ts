import { lt } from "drizzle-orm";

import { db } from "../db/index";
import { sessions } from "../db/schema/index";

/**
 * Deletes session rows that expired (or were revoked) longer ago than the
 * configured retention period. Runs once per day at ~04:00 local time, next to
 * the audit log cleanup. Default retention: 30 days. Override via
 * SESSION_RETENTION_DAYS.
 */
export const startSessionCleanupScheduler = (): NodeJS.Timeout => {
  const INTERVAL_MS = 60 * 60 * 1000; // check every hour
  const retentionDays = parseInt(
    process.env.SESSION_RETENTION_DAYS || "30",
    10,
  );

  const interval = setInterval(async () => {
    const now = new Date();
    if (now.getHours() !== 4) return; // only run at 4am

    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    console.log(
      `[session-cleanup] Deleting sessions expired before ${cutoff.toISOString()} (retention: ${retentionDays} days)…`,
    );

    try {
      const result = await db
        .delete(sessions)
        .where(lt(sessions.expiresAt, cutoff));

      const count = (result as any).rowCount ?? 0;
      console.log(`[session-cleanup] Deleted ${count} old session(s)`);
    } catch (err: any) {
      console.error("[session-cleanup] Scheduler error:", err.message);
    }
  }, INTERVAL_MS);

  console.log(
    `[session-cleanup] Scheduler started (runs daily at 04:00, retention: ${retentionDays} days)`,
  );
  return interval;
};
