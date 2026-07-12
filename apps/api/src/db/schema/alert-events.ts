import {
  pgTable,
  uuid,
  varchar,
  real,
  timestamp,
  index,
  text,
} from "drizzle-orm/pg-core";

import { alertRules } from "./alert-rules";

const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id")
      .references(() => alertRules.id, { onDelete: "cascade" })
      .notNull(),
    serviceType: varchar("service_type", { length: 20 }).notNull(),
    serviceId: uuid("service_id").notNull(),
    serviceName: varchar("service_name", { length: 255 }),
    metric: varchar("metric", { length: 20 }).notNull(),
    value: real("value").notNull(), // actual metric value when triggered
    message: text("message").notNull(),
    resolvedAt: timestamp("resolved_at"), // null = still firing
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("alert_events_rule_idx").on(t.ruleId),
    index("alert_events_created_idx").on(t.createdAt),
    index("alert_events_service_idx").on(t.serviceType, t.serviceId),
  ],
);

type AlertEventT = typeof alertEvents.$inferSelect;

export { alertEvents, type AlertEventT };
