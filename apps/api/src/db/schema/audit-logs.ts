import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Who
    userId: uuid("user_id"),
    userEmail: varchar("user_email", { length: 255 }),
    // What
    action: varchar("action", { length: 100 }).notNull(),
    // On what
    resourceType: varchar("resource_type", { length: 50 }),
    resourceId: uuid("resource_id"),
    resourceName: varchar("resource_name", { length: 255 }),
    // Extra context (diff, params, etc.)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    // Network
    ip: varchar("ip", { length: 45 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_user_id_idx").on(table.userId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_resource_idx").on(table.resourceType, table.resourceId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

type AuditLogT = typeof auditLogs.$inferSelect;

export { auditLogs, type AuditLogT };
