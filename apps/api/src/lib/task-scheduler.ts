import { eq, and, isNotNull } from "drizzle-orm";
import type { Queue } from "bullmq";

import { db } from "../db/index";
import { scheduledTasks, databases, gameServers } from "../db/schema/index";
import { taskQueue, backupQueue, gameBackupQueue } from "./redis";
import { assertValidCron } from "./cron";

import type { ScheduledTaskT, DatabaseT, GameServerT } from "../db/schema/index";

/**
 * Every cron in DeployKit, in one place.
 *
 * BullMQ job schedulers replace the old 60-second polling scheduler: BullMQ
 * parses the pattern itself, honours a timezone, and deduplicates across API
 * processes — none of which the hand-written matcher could do.
 *
 * Schedulers are keyed `task:<taskId>` / `backup:<databaseId>` /
 * `gamebackup:<gameServerId>`, so each namespace can be reconciled
 * independently against its own queue.
 */

interface WantedScheduleI {
  id: string;
  pattern: string;
  /** Omitted for backups: BullMQ then uses process-local time, which is what
   *  the previous backup scheduler did (it read date.getHours()). */
  timezone?: string;
}

interface ScheduleDiffI {
  toUpsert: WantedScheduleI[];
  toRemove: string[];
}

const taskSchedulerId = (taskId: string): string => `task:${taskId}`;
const backupSchedulerId = (databaseId: string): string =>
  `backup:${databaseId}`;
const gameBackupSchedulerId = (gameServerId: string): string =>
  `gamebackup:${gameServerId}`;

/**
 * What to change so Redis matches the DB. Pure, so the reconcile logic is
 * testable without a Redis connection.
 *
 * Existing ids are always re-upserted (upsertJobScheduler overrides), which is
 * how a changed pattern or timezone takes effect. Ids that nothing wants are
 * removed — but only within `namespace`, which is required rather than
 * inferred from `wanted`: the case that matters most is an empty `wanted`
 * (every task deleted), and there is nothing to infer a prefix from there.
 * Without it, reconciling tasks could delete backup schedulers.
 */
const diffSchedules = (
  wanted: WantedScheduleI[],
  existing: string[],
  namespace: "task" | "backup" | "gamebackup",
): ScheduleDiffI => {
  const wantedIds = new Set(wanted.map((w) => w.id));
  const prefix = `${namespace}:`;

  return {
    toUpsert: wanted,
    toRemove: existing.filter(
      (id) => id.startsWith(prefix) && !wantedIds.has(id),
    ),
  };
};

const upsert = async (
  queue: Queue,
  jobName: string,
  schedule: WantedScheduleI,
  data: Record<string, unknown>,
): Promise<void> => {
  await queue.upsertJobScheduler(
    schedule.id,
    {
      pattern: schedule.pattern,
      ...(schedule.timezone ? { tz: schedule.timezone } : {}),
    },
    { name: jobName, data },
  );
};

/** Register (or re-register) a task's cron. A task with no cron, or a disabled
 *  one, has its scheduler removed instead. */
const upsertTaskSchedule = async (task: ScheduledTaskT): Promise<void> => {
  if (!task.cron || !task.enabled) {
    await removeTaskSchedule(task.id);
    return;
  }
  assertValidCron(task.cron, task.timezone);
  await upsert(
    taskQueue,
    "task",
    {
      id: taskSchedulerId(task.id),
      pattern: task.cron,
      timezone: task.timezone,
    },
    { taskId: task.id },
  );
};

const removeTaskSchedule = async (taskId: string): Promise<void> => {
  await taskQueue.removeJobScheduler(taskSchedulerId(taskId)).catch(() => {});
};

/** Same for a database backup. No timezone is passed on purpose — see
 *  WantedScheduleI. */
const upsertBackupSchedule = async (database: DatabaseT): Promise<void> => {
  if (!database.backupEnabled || !database.backupCron) {
    await removeBackupSchedule(database.id);
    return;
  }
  assertValidCron(database.backupCron, "UTC");
  await upsert(
    backupQueue,
    "backup",
    { id: backupSchedulerId(database.id), pattern: database.backupCron },
    { databaseId: database.id },
  );
};

const removeBackupSchedule = async (databaseId: string): Promise<void> => {
  await backupQueue
    .removeJobScheduler(backupSchedulerId(databaseId))
    .catch(() => {});
};

/** Same for a game server's world backup. No timezone, like database backups. */
const upsertGameBackupSchedule = async (
  server: Pick<GameServerT, "id" | "backupEnabled" | "backupCron">,
): Promise<void> => {
  if (!server.backupEnabled || !server.backupCron) {
    await removeGameBackupSchedule(server.id);
    return;
  }
  assertValidCron(server.backupCron, "UTC");
  await upsert(
    gameBackupQueue,
    "backup",
    { id: gameBackupSchedulerId(server.id), pattern: server.backupCron },
    { gameServerId: server.id, trigger: "schedule" },
  );
};

const removeGameBackupSchedule = async (gameServerId: string): Promise<void> => {
  await gameBackupQueue
    .removeJobScheduler(gameBackupSchedulerId(gameServerId))
    .catch(() => {});
};

/**
 * Bring Redis in line with the DB at boot: register every wanted schedule and
 * drop the ones whose row disappeared while the process was down.
 */
const reconcileSchedules = async (): Promise<void> => {
  // Tasks
  const tasks = await db.query.scheduledTasks.findMany({
    where: and(
      eq(scheduledTasks.enabled, true),
      isNotNull(scheduledTasks.cron),
    ),
  });
  const wantedTasks: WantedScheduleI[] = [];
  for (const task of tasks) {
    try {
      assertValidCron(task.cron!, task.timezone);
      wantedTasks.push({
        id: taskSchedulerId(task.id),
        pattern: task.cron!,
        timezone: task.timezone,
      });
    } catch (err: any) {
      console.error(
        `[scheduler] Task ${task.id} has an invalid cron and was not scheduled: ${err.message}`,
      );
    }
  }

  const existingTasks = (await taskQueue.getJobSchedulers(0, -1)).map(
    (s) => s.key,
  );
  const taskDiff = diffSchedules(wantedTasks, existingTasks, "task");
  for (const s of taskDiff.toUpsert) {
    await upsert(taskQueue, "task", s, { taskId: s.id.slice("task:".length) });
  }
  for (const id of taskDiff.toRemove) {
    await taskQueue.removeJobScheduler(id).catch(() => {});
  }

  // Backups
  const dbs = await db.query.databases.findMany({
    where: eq(databases.backupEnabled, true),
  });
  const wantedBackups: WantedScheduleI[] = [];
  for (const database of dbs) {
    if (!database.backupCron) continue;
    try {
      assertValidCron(database.backupCron, "UTC");
      wantedBackups.push({
        id: backupSchedulerId(database.id),
        pattern: database.backupCron,
      });
    } catch (err: any) {
      console.error(
        `[scheduler] Database ${database.id} has an invalid backup cron and was not scheduled: ${err.message}`,
      );
    }
  }

  const existingBackups = (await backupQueue.getJobSchedulers(0, -1)).map(
    (s) => s.key,
  );
  const backupDiff = diffSchedules(wantedBackups, existingBackups, "backup");
  for (const s of backupDiff.toUpsert) {
    await upsert(backupQueue, "backup", s, {
      databaseId: s.id.slice("backup:".length),
    });
  }
  for (const id of backupDiff.toRemove) {
    await backupQueue.removeJobScheduler(id).catch(() => {});
  }

  // Game server backups
  const games = await db.query.gameServers.findMany({
    where: eq(gameServers.backupEnabled, true),
    columns: { id: true, backupCron: true },
  });
  const wantedGameBackups: WantedScheduleI[] = [];
  for (const game of games) {
    if (!game.backupCron) continue;
    try {
      assertValidCron(game.backupCron, "UTC");
      wantedGameBackups.push({
        id: gameBackupSchedulerId(game.id),
        pattern: game.backupCron,
      });
    } catch (err: any) {
      console.error(
        `[scheduler] Game server ${game.id} has an invalid backup cron and was not scheduled: ${err.message}`,
      );
    }
  }

  const existingGameBackups = (
    await gameBackupQueue.getJobSchedulers(0, -1)
  ).map((s) => s.key);
  const gameDiff = diffSchedules(
    wantedGameBackups,
    existingGameBackups,
    "gamebackup",
  );
  for (const s of gameDiff.toUpsert) {
    await upsert(gameBackupQueue, "backup", s, {
      gameServerId: s.id.slice("gamebackup:".length),
      trigger: "schedule",
    });
  }
  for (const id of gameDiff.toRemove) {
    await gameBackupQueue.removeJobScheduler(id).catch(() => {});
  }

  console.log(
    `[scheduler] Reconciled ${wantedTasks.length} task schedule(s), ` +
      `${wantedBackups.length} backup schedule(s) and ` +
      `${wantedGameBackups.length} game backup schedule(s)`,
  );
};

export {
  taskSchedulerId,
  backupSchedulerId,
  diffSchedules,
  upsertTaskSchedule,
  removeTaskSchedule,
  upsertBackupSchedule,
  removeBackupSchedule,
  gameBackupSchedulerId,
  upsertGameBackupSchedule,
  removeGameBackupSchedule,
  reconcileSchedules,
  type WantedScheduleI,
  type ScheduleDiffI,
};
