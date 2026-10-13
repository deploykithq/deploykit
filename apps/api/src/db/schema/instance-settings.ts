import { pgTable, varchar, text, uuid, timestamp } from "drizzle-orm/pg-core";

import { users } from "./users";

/**
 * Instance-wide settings an admin edits at runtime (third-party API keys).
 * `value` is always `encrypt(...)` output; read it through
 * `services/instance-settings.ts`, never directly.
 */
const instanceSettings = pgTable("instance_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

type InstanceSettingT = typeof instanceSettings.$inferSelect;

export { instanceSettings, type InstanceSettingT };
