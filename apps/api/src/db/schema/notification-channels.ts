import {
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { projects } from "./projects";


export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 100 }).notNull(),
    // Channel type
    type: varchar("type", { length: 20 }).notNull(), // discord | slack | telegram | email | webhook
    // Channel-specific config (encrypted JSON stored as text would be overkill here —
    // webhook URLs aren't secrets at the level of DB passwords, and we want to query by type)
    config: jsonb("config").$type<Record<string, string>>().notNull(),
    // Which events trigger this channel
    events: jsonb("events")
      .$type<string[]>()
      .default(["deploy.success", "deploy.failed"])
      .notNull(),
    // State
    enabled: boolean("enabled").default(true).notNull(),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("notif_channels_project_idx").on(t.projectId)],
);

export const notificationChannelRelations = relations(
  notificationChannels,
  ({ one }) => ({
    project: one(projects, {
      fields: [notificationChannels.projectId],
      references: [projects.id],
    }),
  }),
);

export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NewNotificationChannel = typeof notificationChannels.$inferInsert;

// Supported event types
export const NOTIFICATION_EVENTS = [
  "deploy.success",
  "deploy.failed",
  "app.stopped",
  "app.error",
  "backup.failed",
  "backup.completed",
  "health_check.failed",
  "alert.fired",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const CHANNEL_TYPES = {
  discord: {
    label: "Discord",
    configFields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://discord.com/api/webhooks/...",
      },
    ],
  },
  slack: {
    label: "Slack",
    configFields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://hooks.slack.com/services/...",
      },
    ],
  },
  telegram: {
    label: "Telegram",
    configFields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF..." },
      { key: "chatId", label: "Chat ID", placeholder: "-1001234567890" },
    ],
  },
  email: {
    label: "Email",
    configFields: [
      {
        key: "to",
        label: "Recipient(s)",
        placeholder: "team@example.com, ops@example.com",
      },
      { key: "resendApiKey", label: "Resend API Key", placeholder: "re_..." },
      {
        key: "from",
        label: "From address",
        placeholder: "DeployKit <notifications@example.com>",
      },
    ],
  },
  webhook: {
    label: "Webhook",
    configFields: [
      {
        key: "url",
        label: "URL",
        placeholder: "https://api.example.com/webhook",
      },
      { key: "secret", label: "Secret (optional)", placeholder: "hmac-secret" },
    ],
  },
} as const;

export type ChannelType = keyof typeof CHANNEL_TYPES;
