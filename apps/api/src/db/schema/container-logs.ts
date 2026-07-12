import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

const containerLogs = pgTable(
  "container_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceId: uuid("service_id").notNull(),
    serviceType: varchar("service_type", { length: 20 }).notNull(), // application | database
    containerId: varchar("container_id", { length: 100 }).notNull(),
    stream: varchar("stream", { length: 8 }), // stdout | stderr | null
    level: varchar("level", { length: 10 }), // error|warn|info|debug|fatal|null (best-effort)
    message: text("message").notNull(),
    timestamp: timestamp("timestamp").notNull(), // parsed from Docker's RFC3339 prefix
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("container_logs_lookup_idx").on(t.serviceId, t.timestamp),
    index("container_logs_level_idx").on(t.serviceId, t.level),
  ],
);

type ContainerLogRowT = typeof containerLogs.$inferSelect;
type NewContainerLogRowT = typeof containerLogs.$inferInsert;

export { containerLogs, type ContainerLogRowT, type NewContainerLogRowT };
