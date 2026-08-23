import { Hash, Mail, MessageSquare, Send, Webhook } from "lucide-react";

const SOURCE_TYPE_OPTIONS = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "git", label: "Git (any)" },
  { value: "docker_image", label: "Docker Image" },
];

const BUILD_TYPE_OPTIONS = [
  { value: "nixpacks", label: "Nixpacks (auto-detect)" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "buildpacks", label: "Buildpacks" },
];

const DB_TYPE_OPTIONS = [
  { value: "postgresql", label: "PostgreSQL 16" },
  { value: "mongodb", label: "MongoDB 7" },
  { value: "redis", label: "Redis 7" },
  { value: "mysql", label: "MySQL 8" },
  { value: "mariadb", label: "MariaDB 11" },
];

const ROLE_STYLES: Record<string, { bg: string; text: string; label: string }> =
  {
    admin: { bg: "bg-danger/10", text: "text-danger", label: "Admin" },
    operator: { bg: "bg-accent/10", text: "text-accent", label: "Operator" },
    viewer: { bg: "bg-surface-2", text: "text-text-muted", label: "Viewer" },
  };

const CHANNEL_ICONS: Record<string, any> = {
  discord: Hash,
  slack: MessageSquare,
  telegram: Send,
  email: Mail,
  webhook: Webhook,
};

const CHANNEL_COLORS: Record<string, string> = {
  discord: "text-indigo-400",
  slack: "text-green-400",
  telegram: "text-blue-400",
  email: "text-amber-400",
  webhook: "text-text-secondary",
};

const CHANNEL_TYPES = {
  discord: {
    label: "Discord",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://discord.com/api/webhooks/...",
      },
    ],
  },
  slack: {
    label: "Slack",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://hooks.slack.com/services/...",
      },
    ],
  },
  telegram: {
    label: "Telegram",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "123456:ABC-DEF...",
      },
      { key: "chatId", label: "Chat ID", placeholder: "-1001234567890" },
    ],
  },
  email: {
    label: "Email (Resend)",
    fields: [
      {
        key: "to",
        label: "Recipient(s)",
        placeholder: "team@example.com, ops@example.com",
      },
      {
        key: "resendApiKey",
        label: "Resend API Key",
        placeholder: "re_...",
      },
      {
        key: "from",
        label: "From address (optional)",
        placeholder: "DeployKit <notifications@example.com>",
      },
    ],
  },
  webhook: {
    label: "Webhook",
    fields: [
      {
        key: "url",
        label: "URL",
        placeholder: "https://api.example.com/webhook",
      },
      {
        key: "secret",
        label: "HMAC Secret (optional)",
        placeholder: "your-secret",
      },
    ],
  },
};

const ALL_EVENTS = [
  { value: "deploy.success", label: "Deploy Success" },
  { value: "deploy.failed", label: "Deploy Failed" },
  { value: "app.stopped", label: "App Stopped" },
  { value: "app.error", label: "App Error" },
  { value: "backup.failed", label: "Backup Failed" },
  { value: "backup.completed", label: "Backup Completed" },
  { value: "health_check.failed", label: "Health Check Failed" },
  { value: "alert.fired", label: "Alert Fired" },
];

/** Cuánto se muestra el resultado del test de un canal de notificación. */
const TEST_RESULT_FEEDBACK_MS = 5000;

export {
  SOURCE_TYPE_OPTIONS,
  BUILD_TYPE_OPTIONS,
  DB_TYPE_OPTIONS,
  ROLE_STYLES,
  CHANNEL_ICONS,
  CHANNEL_COLORS,
  CHANNEL_TYPES,
  ALL_EVENTS,
  TEST_RESULT_FEEDBACK_MS,
};
