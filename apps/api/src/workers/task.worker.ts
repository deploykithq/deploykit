import { Worker, type Job } from "bullmq";
import { and, eq, ne } from "drizzle-orm";

import { db } from "../db/index";
import { scheduledTasks, taskRuns } from "../db/schema/index";
import { redis } from "../lib/redis";
import { runTaskRun } from "../services/task-runner";

/**
 * Runs scheduled tasks and one-off commands.
 *
 * Two job shapes:
 *   • { taskId } — from a BullMQ job scheduler; this worker creates the run row.
 *   • { runId }  — from the API, which created the row first so the client could
 *                  subscribe to its output before the container existed.
 */
interface TaskJobDataI {
  taskId?: string;
  runId?: string;
}

/** Concurrency 3: commands are long (a migration), but a single stuck run must
 *  not block every other service's schedule. */
const CONCURRENCY = 3;

const startTaskWorker = () => {
  const worker = new Worker<TaskJobDataI>(
    "task",
    async (job: Job<TaskJobDataI>) => {
      if (job.data.runId) {
        if (!(await claimManualRun(job.data.runId))) return;
        await runTaskRun(job.data.runId);
        return;
      }
      const runId = await createRunForTask(job.data.taskId);
      if (runId) await runTaskRun(runId);
    },
    { connection: redis, concurrency: CONCURRENCY },
  );

  worker.on("failed", (job, err) => {
    console.error(`[task-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[task-worker] Worker started");
  return worker;
};

/**
 * Create the run row for a scheduled firing, unless the previous run of the
 * same task is still going — Laravel's withoutOverlapping, and what keeps an
 * every-minute `schedule:run` from piling up.
 */
const createRunForTask = async (
  taskId: string | undefined,
): Promise<string | null> => {
  if (!taskId) return null;

  const task = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, taskId),
  });
  if (!task || !task.enabled) return null;

  const owner = {
    applicationId: task.applicationId,
    composeServiceId: task.composeServiceId,
    databaseId: task.databaseId,
    serviceName: task.serviceName,
  };

  const running = await db.query.taskRuns.findFirst({
    where: and(eq(taskRuns.taskId, taskId), eq(taskRuns.status, "running")),
  });

  if (running) {
    await db.insert(taskRuns).values({
      ...owner,
      taskId,
      taskName: task.name,
      command: task.command,
      status: "skipped",
      trigger: "schedule",
      finishedAt: new Date(),
      durationMs: 0,
    });
    console.log(
      `[task-worker] Skipped "${task.name}": the previous run is still going`,
    );
    return null;
  }

  const [run] = await db
    .insert(taskRuns)
    .values({
      ...owner,
      taskId,
      taskName: task.name,
      command: task.command,
      timeoutSeconds: task.timeoutSeconds,
      status: "running",
      trigger: "schedule",
    })
    .returning();

  return run?.id ?? null;
};

/**
 * The same guard for a manual run, whose row already exists: mark it skipped
 * and report that it must not run.
 */
const claimManualRun = async (runId: string): Promise<boolean> => {
  const run = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, runId),
  });
  if (!run) return false;
  if (!run.taskId) return true; // ad-hoc: nothing to overlap with

  const other = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.taskId, run.taskId),
      eq(taskRuns.status, "running"),
      ne(taskRuns.id, runId),
    ),
  });
  if (!other) return true;

  await db
    .update(taskRuns)
    .set({ status: "skipped", finishedAt: new Date(), durationMs: 0 })
    .where(eq(taskRuns.id, runId));
  return false;
};

export { startTaskWorker, claimManualRun };
