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

/**
 * A named command on one service, with an optional cron.
 *
 * Exactly one owner column is set (CHECK `scheduled_tasks_owner_check`), the
 * same polymorphic shape `deployments` uses. `cron === null` means the task is
 * manual-only.
 */
const scheduledTasks = pgTable("scheduled_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
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
  /** Compose service to run in — set iff `composeServiceId` is set. */
  serviceName: varchar("service_name", { length: 100 }),
  name: varchar("name", { length: 255 }).notNull(),
  command: text("command").notNull(),
  /** null = manual-only saved command. */
  cron: varchar("cron", { length: 100 }),
  timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  timeoutSeconds: integer("timeout_seconds").default(300).notNull(),
  // Denormalised so the list view needs no lateral join.
  lastRunAt: timestamp("last_run_at"),
  lastStatus: varchar("last_status", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const scheduledTaskRelations = relations(scheduledTasks, ({ one }) => ({
  application: one(applications, {
    fields: [scheduledTasks.applicationId],
    references: [applications.id],
  }),
  composeService: one(composeServices, {
    fields: [scheduledTasks.composeServiceId],
    references: [composeServices.id],
  }),
  database: one(databases, {
    fields: [scheduledTasks.databaseId],
    references: [databases.id],
  }),
}));

type ScheduledTaskT = typeof scheduledTasks.$inferSelect;
type NewScheduledTaskT = typeof scheduledTasks.$inferInsert;

export {
  scheduledTasks,
  scheduledTaskRelations,
  type ScheduledTaskT,
  type NewScheduledTaskT,
};
