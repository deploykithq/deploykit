import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Target
    serviceType: varchar("service_type", { length: 20 }).notNull(), // application | database
    serviceId: uuid("service_id").notNull(),
    serviceName: varchar("service_name", { length: 255 }),
    // Condition
    metric: varchar("metric", { length: 20 }).notNull(), // cpu | memory | net_rx | net_tx
    operator: varchar("operator", { length: 5 }).notNull(), // gt | lt
    threshold: integer("threshold").notNull(), // 0-100 for cpu/mem, bytes/s for net
    // Delivery
    channel: varchar("channel", { length: 20 }).notNull(), // ui | slack | webhook
    channelConfig: jsonb("channel_config").$type<Record<string, string>>(), // { url: "..." }
    // Behaviour
    cooldownMinutes: integer("cooldown_minutes").default(15).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("alert_rules_service_idx").on(t.serviceType, t.serviceId)],
);

type AlertRuleT = typeof alertRules.$inferSelect;

export { alertRules, type AlertRuleT };
