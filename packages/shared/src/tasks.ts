import { z } from "zod";

/** The three kinds of service a task can run a command in. */
export const TaskTargetKind = z.enum(["application", "compose", "database"]);
export type TaskTargetKindT = z.infer<typeof TaskTargetKind>;

export const COMMAND_MAX_LENGTH = 4000;
export const TASK_TIMEOUT_MIN_SECONDS = 1;
export const TASK_TIMEOUT_MAX_SECONDS = 86_400;
export const TASK_TIMEOUT_DEFAULT_SECONDS = 300;

/** Longest cron pattern we store; the API validates the pattern itself. */
export const CRON_MAX_LENGTH = 100;

/**
 * A task belongs to exactly one service. A stack has many containers, so a
 * Compose target must also name the service to run in — and only a Compose
 * target may, which is what the refine below pins down.
 */
export const taskTargetSchema = z
  .object({
    kind: TaskTargetKind,
    id: z.string().uuid(),
    serviceName: z.string().trim().min(1).max(100).optional(),
  })
  .refine((t) => (t.kind === "compose") === (t.serviceName !== undefined), {
    message:
      "serviceName is required for compose targets and not allowed for others",
    path: ["serviceName"],
  });
export type TaskTargetI = z.infer<typeof taskTargetSchema>;

const commandSchema = z.string().trim().min(1).max(COMMAND_MAX_LENGTH);

/**
 * An IANA zone name. Checked by asking Intl to build a formatter for it, which
 * is the only check that agrees with what the runtime will actually accept.
 */
const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Unknown time zone" },
  );

const timeoutSchema = z
  .number()
  .int()
  .min(TASK_TIMEOUT_MIN_SECONDS)
  .max(TASK_TIMEOUT_MAX_SECONDS);

/**
 * `cron` is nullable on purpose: a task without one is a saved command that
 * only ever runs when somebody presses Run. The pattern's validity is checked
 * in the API (lib/cron.ts) with the same parser BullMQ schedules with — this
 * package has no cron dependency.
 */
export const createTaskSchema = z.object({
  target: taskTargetSchema,
  name: z.string().trim().min(1).max(255),
  command: commandSchema,
  cron: z.string().trim().min(1).max(CRON_MAX_LENGTH).nullable().optional(),
  timezone: timezoneSchema.default("UTC"),
  enabled: z.boolean().default(true),
  timeoutSeconds: timeoutSchema.default(TASK_TIMEOUT_DEFAULT_SECONDS),
});

export const updateTaskSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  command: commandSchema.optional(),
  cron: z.string().trim().min(1).max(CRON_MAX_LENGTH).nullable().optional(),
  timezone: timezoneSchema.optional(),
  enabled: z.boolean().optional(),
  timeoutSeconds: timeoutSchema.optional(),
});

export const runAdHocSchema = z.object({
  target: taskTargetSchema,
  command: commandSchema,
  timeoutSeconds: timeoutSchema.default(TASK_TIMEOUT_DEFAULT_SECONDS),
});

export const TaskRunStatus = z.enum([
  "running",
  "success",
  "failed",
  "timed_out",
  "skipped",
]);
export type TaskRunStatusT = z.infer<typeof TaskRunStatus>;

export const TaskRunTrigger = z.enum(["schedule", "manual"]);
export type TaskRunTriggerT = z.infer<typeof TaskRunTrigger>;
