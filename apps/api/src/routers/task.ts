import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";

import { scheduledTasks, taskRuns, composeServices } from "../db/schema/index";

import { router, protectedProcedure, operatorProcedure } from "../trpc";

import { taskQueue } from "../lib/redis";
import { logAction } from "../lib/audit/audit";
import {
  assertValidCron,
  nextRunAt,
  nextRuns,
  InvalidCronError,
} from "../lib/cron";
import { upsertTaskSchedule, removeTaskSchedule } from "../lib/task-scheduler";
import {
  getProjectRoleByAppId,
  getProjectRoleByComposeId,
  getProjectRoleByDbId,
  canOperate,
  canView,
  canViewSecrets,
} from "../lib/permissions";
import { listComposeServices } from "../services/compose";

import {
  createTaskSchema,
  updateTaskSchema,
  runAdHocSchema,
  taskTargetSchema,
} from "@deploykit/shared";

import type { Context } from "../trpc";
// UserRole lives in the shared package — lib/permissions imports it from there
// too, and does not re-export it.
import type { TaskTargetI, UserRole } from "@deploykit/shared";

/**
 * Tasks are `operatorProcedure` for anything that defines or runs a command,
 * because running an arbitrary command in a container is the web terminal in
 * power — and services/terminal.ts gates that on the *global* role. Gating
 * only on the project role would hand arbitrary execution to a global viewer
 * who happens to be operator of one project. Both layers apply, always.
 *
 * Reads are `protectedProcedure` + a project-role check: metadata for any
 * member, output only for canViewSecrets, since a migration can print a
 * connection string.
 */

/**
 * Existence is not revealed to non-members.
 *
 * The explicit `() => never` annotation on the binding (not just on the arrow)
 * is what lets TypeScript treat a call to this as a control-flow terminator.
 */
const NOT_FOUND: () => never = () => {
  throw new TRPCError({ code: "NOT_FOUND", message: "Task target not found" });
};

const FORBIDDEN = (message: string): never => {
  throw new TRPCError({ code: "FORBIDDEN", message });
};

/** Resolve the caller's project role for a target, or reject. */
const roleForTarget = async (
  ctx: Pick<Context, "user" | "db">,
  target: TaskTargetI,
): Promise<UserRole> => {
  const role =
    target.kind === "application"
      ? await getProjectRoleByAppId(ctx.user!, target.id)
      : target.kind === "compose"
        ? await getProjectRoleByComposeId(ctx.user!, target.id)
        : await getProjectRoleByDbId(ctx.user!, target.id);

  if (!role) NOT_FOUND();
  return role;
};

/** The owner columns for a target, as stored on both tables. */
const ownerColumns = (target: TaskTargetI) => ({
  applicationId: target.kind === "application" ? target.id : null,
  composeServiceId: target.kind === "compose" ? target.id : null,
  databaseId: target.kind === "database" ? target.id : null,
  serviceName: target.kind === "compose" ? target.serviceName! : null,
});

const whereTarget = (target: TaskTargetI) =>
  target.kind === "application"
    ? eq(scheduledTasks.applicationId, target.id)
    : target.kind === "compose"
      ? eq(scheduledTasks.composeServiceId, target.id)
      : eq(scheduledTasks.databaseId, target.id);

const whereRunTarget = (target: TaskTargetI) =>
  target.kind === "application"
    ? eq(taskRuns.applicationId, target.id)
    : target.kind === "compose"
      ? eq(taskRuns.composeServiceId, target.id)
      : eq(taskRuns.databaseId, target.id);

/** A Compose target must name a service the stack actually declares. */
const assertComposeService = async (
  ctx: Pick<Context, "db">,
  target: TaskTargetI,
): Promise<void> => {
  if (target.kind !== "compose") return;
  const stack = await ctx.db.query.composeServices.findFirst({
    where: eq(composeServices.id, target.id),
    columns: { composeFile: true },
  });
  if (!stack) NOT_FOUND();
  const services = listComposeServices(stack.composeFile);
  if (!services.includes(target.serviceName!)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This stack has no service named "${target.serviceName}". Available: ${services.join(", ")}`,
    });
  }
};

const validateCronOrThrow = (cron: string, timezone: string): void => {
  try {
    assertValidCron(cron, timezone);
  } catch (err) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        err instanceof InvalidCronError
          ? err.message
          : "Invalid cron expression",
    });
  }
};

/** Task row + when it will next fire, for the list view. */
const withNextRun = (task: typeof scheduledTasks.$inferSelect) => {
  const { cron, timezone, enabled } = task;
  let next: Date | null = null;
  if (cron && enabled) {
    try {
      next = nextRunAt(cron, timezone);
    } catch {
      next = null;
    }
  }
  return { ...task, nextRunAt: next };
};

/** Rebuild the target union from a stored row. */
const targetOf = (row: {
  applicationId: string | null;
  composeServiceId: string | null;
  databaseId: string | null;
  serviceName: string | null;
}): TaskTargetI => {
  if (row.applicationId) {
    return { kind: "application", id: row.applicationId };
  }
  if (row.composeServiceId) {
    return {
      kind: "compose",
      id: row.composeServiceId,
      serviceName: row.serviceName ?? "",
    };
  }
  return { kind: "database", id: row.databaseId! };
};

export const taskRouter = router({
  list: protectedProcedure
    .input(z.object({ target: taskTargetSchema }))
    .query(async ({ ctx, input }) => {
      const role = await roleForTarget(ctx, input.target);
      if (!canView(role)) NOT_FOUND();

      const rows = await ctx.db.query.scheduledTasks.findMany({
        where: whereTarget(input.target),
        orderBy: [desc(scheduledTasks.createdAt)],
      });
      return rows.map(withNextRun);
    }),

  previewCron: protectedProcedure
    .input(
      z.object({
        cron: z.string().min(1).max(100),
        timezone: z.string().min(1).max(64),
      }),
    )
    .query(({ input }) => {
      validateCronOrThrow(input.cron, input.timezone);
      return nextRuns(input.cron, input.timezone, 3).map((d) =>
        d.toISOString(),
      );
    }),

  create: operatorProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await roleForTarget(ctx, input.target);
      if (!canOperate(role)) {
        FORBIDDEN("Operator access required for this project");
      }
      await assertComposeService(ctx, input.target);
      if (input.cron) validateCronOrThrow(input.cron, input.timezone);

      const [task] = await ctx.db
        .insert(scheduledTasks)
        .values({
          ...ownerColumns(input.target),
          name: input.name,
          command: input.command,
          cron: input.cron ?? null,
          timezone: input.timezone,
          enabled: input.enabled,
          timeoutSeconds: input.timeoutSeconds,
        })
        .returning();

      await upsertTaskSchedule(task!);
      await logAction(ctx, {
        action: "task.create",
        resourceType: "task",
        resourceId: task!.id,
        resourceName: task!.name,
        metadata: { command: task!.command, cron: task!.cron },
      });

      return withNextRun(task!);
    }),

  update: operatorProcedure
    .input(updateTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.scheduledTasks.findFirst({
        where: eq(scheduledTasks.id, input.id),
      });
      if (!existing) NOT_FOUND();

      const role = await roleForTarget(ctx, targetOf(existing));
      if (!canOperate(role)) {
        FORBIDDEN("Operator access required for this project");
      }

      const cron = input.cron === undefined ? existing.cron : input.cron;
      const timezone = input.timezone ?? existing.timezone;
      if (cron) validateCronOrThrow(cron, timezone);

      const { id, ...changes } = input;
      const [task] = await ctx.db
        .update(scheduledTasks)
        .set({
          ...changes,
          ...(input.cron !== undefined && { cron: input.cron }),
          updatedAt: new Date(),
        })
        .where(eq(scheduledTasks.id, id))
        .returning();

      // The schedule has to change now, not at the next restart.
      await upsertTaskSchedule(task!);
      await logAction(ctx, {
        action: "task.update",
        resourceType: "task",
        resourceId: task!.id,
        resourceName: task!.name,
      });

      return withNextRun(task!);
    }),

  delete: operatorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.scheduledTasks.findFirst({
        where: eq(scheduledTasks.id, input.id),
      });
      if (!existing) NOT_FOUND();

      const role = await roleForTarget(ctx, targetOf(existing));
      if (!canOperate(role)) {
        FORBIDDEN("Operator access required for this project");
      }

      await removeTaskSchedule(input.id);
      await ctx.db.delete(scheduledTasks).where(eq(scheduledTasks.id, input.id));
      await logAction(ctx, {
        action: "task.delete",
        resourceType: "task",
        resourceId: existing.id,
        resourceName: existing.name,
      });

      return { success: true };
    }),

  runNow: operatorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.scheduledTasks.findFirst({
        where: eq(scheduledTasks.id, input.id),
      });
      if (!task) NOT_FOUND();

      const role = await roleForTarget(ctx, targetOf(task));
      if (!canOperate(role)) {
        FORBIDDEN("Operator access required for this project");
      }

      // The row is created here, before the job is queued, so the client can
      // subscribe to its output room immediately.
      const [run] = await ctx.db
        .insert(taskRuns)
        .values({
          applicationId: task.applicationId,
          composeServiceId: task.composeServiceId,
          databaseId: task.databaseId,
          serviceName: task.serviceName,
          taskId: task.id,
          taskName: task.name,
          command: task.command,
          timeoutSeconds: task.timeoutSeconds,
          status: "running",
          trigger: "manual",
          triggeredBy: ctx.user.id,
        })
        .returning();

      await taskQueue.add("task", { runId: run!.id });
      await logAction(ctx, {
        action: "task.run",
        resourceType: "task",
        resourceId: task.id,
        resourceName: task.name,
        metadata: { runId: run!.id, command: task.command },
      });

      return run!;
    }),

  runAdHoc: operatorProcedure
    .input(runAdHocSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await roleForTarget(ctx, input.target);
      if (!canOperate(role)) {
        FORBIDDEN("Operator access required for this project");
      }
      await assertComposeService(ctx, input.target);

      const [run] = await ctx.db
        .insert(taskRuns)
        .values({
          ...ownerColumns(input.target),
          command: input.command,
          timeoutSeconds: input.timeoutSeconds,
          status: "running",
          trigger: "manual",
          triggeredBy: ctx.user.id,
        })
        .returning();

      await taskQueue.add("task", { runId: run!.id });
      await logAction(ctx, {
        action: "task.run_adhoc",
        resourceType: "task",
        resourceId: run!.id,
        metadata: { command: input.command, target: input.target },
      });

      return run!;
    }),

  runs: protectedProcedure
    .input(
      z.object({
        target: taskTargetSchema,
        taskId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const role = await roleForTarget(ctx, input.target);
      if (!canView(role)) NOT_FOUND();

      // Metadata only — `output` is deliberately absent, see runOutput.
      return ctx.db.query.taskRuns.findMany({
        where: input.taskId
          ? and(whereRunTarget(input.target), eq(taskRuns.taskId, input.taskId))
          : whereRunTarget(input.target),
        columns: {
          id: true,
          taskId: true,
          taskName: true,
          command: true,
          status: true,
          exitCode: true,
          trigger: true,
          triggeredBy: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
        },
        orderBy: [desc(taskRuns.startedAt)],
        limit: input.limit,
      });
    }),

  runOutput: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.taskRuns.findFirst({
        where: eq(taskRuns.id, input.id),
      });
      if (!run) NOT_FOUND();

      const role = await roleForTarget(ctx, targetOf(run));
      // Output can contain secrets a migration printed, so this is the env-var
      // gate, not plain membership.
      if (!canViewSecrets(role)) {
        FORBIDDEN("Operator access required to read command output");
      }

      return {
        id: run.id,
        status: run.status,
        exitCode: run.exitCode,
        output: run.output ?? "",
        outputTruncated: run.outputTruncated,
        durationMs: run.durationMs,
      };
    }),
});
