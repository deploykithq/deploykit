import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { applications } from "./applications";
import { composeServices } from "./compose-services";
import { databases } from "./databases";
import { scheduledTasks } from "./scheduled-tasks";
import { users } from "./users";

/**
 * One execution. `taskId` is null for an ad-hoc command and for a run whose
 * task was deleted afterwards — `taskName` and `command` are snapshots so the
 * history stays readable either way.
 *
 * `status` is one of TaskRunStatus ("running" | "success" | "failed" |
 * "timed_out" | "skipped"); `trigger` is one of TaskRunTrigger
 * ("schedule" | "manual"). Both live in @deploykit/shared.
 */
const taskRuns = pgTable("task_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").references(() => scheduledTasks.id, {
    onDelete: "set null",
  }),
  taskName: varchar("task_name", { length: 255 }),
  applicationId: uuid("application_id").references(() => applications.id, {
    onDelete: "cascade",
  }),
  composeServiceId: uuid("compose_service_id").references(
    () => composeServices.id,
    { onDelete: "cascade" },
  ),
  databaseId: uuid("database_id").references(() => databases.id, {
    onDelete: "cascade",
  }),
  serviceName: varchar("service_name", { length: 100 }),
  command: text("command").notNull(),
  /** Snapshot of the timeout this run was started with. */
  timeoutSeconds: integer("timeout_seconds").default(300).notNull(),
  status: varchar("status", { length: 20 }).default("running").notNull(),
  exitCode: integer("exit_code"),
  /** Tail of the combined stdout+stderr, capped by lib/output-tail.ts. */
  output: text("output"),
  outputTruncated: boolean("output_truncated").default(false).notNull(),
  trigger: varchar("trigger", { length: 20 }).notNull(),
  triggeredBy: uuid("triggered_by").references(() => users.id, {
    onDelete: "set null",
  }),
  containerId: varchar("container_id", { length: 100 }),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  durationMs: integer("duration_ms"),
});

const taskRunRelations = relations(taskRuns, ({ one }) => ({
  task: one(scheduledTasks, {
    fields: [taskRuns.taskId],
    references: [scheduledTasks.id],
  }),
  triggeredByUser: one(users, {
    fields: [taskRuns.triggeredBy],
    references: [users.id],
  }),
}));

type TaskRunT = typeof taskRuns.$inferSelect;
type NewTaskRunT = typeof taskRuns.$inferInsert;

export { taskRuns, taskRunRelations, type TaskRunT, type NewTaskRunT };
