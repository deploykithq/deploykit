import { Shield, HardDrive, BarChart3, ScrollText } from "lucide-react";

import { TabT } from "@database/infrastructure/ui/interfaces/database.interfaces";

const DB_TYPE_EMOJI: Record<string, string> = {
  postgresql: "🐘",
  mongodb: "🍃",
  redis: "🔴",
  mysql: "🐬",
  mariadb: "🦭",
};

const TABS: { id: TabT; label: string; icon: React.ElementType }[] = [
  { id: "connection", label: "Connection", icon: Shield },
  { id: "backups", label: "Backups", icon: HardDrive },
  { id: "monitoring", label: "Monitoring", icon: BarChart3 },
  { id: "logs", label: "Logs", icon: ScrollText },
];

const CRON_PRESETS = [
  { value: "0 2 * * *", label: "Daily at 2:00 AM" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 */12 * * *", label: "Every 12 hours" },
  { value: "0 0 * * 0", label: "Weekly (Sunday midnight)" },
  { value: "0 0 1 * *", label: "Monthly (1st at midnight)" },
];

const BACKUP_REFRESH_DELAY_MS = 5000;
const COPY_FEEDBACK_MS = 2000;
const SUCCESS_FEEDBACK_MS = 3000;

/** Cada cuánto se refrescan las alertas abiertas de la base de datos. */
const ALERTS_REFETCH_MS = 30_000;

export {
  DB_TYPE_EMOJI,
  TABS,
  CRON_PRESETS,
  BACKUP_REFRESH_DELAY_MS,
  COPY_FEEDBACK_MS,
  SUCCESS_FEEDBACK_MS,
  ALERTS_REFETCH_MS,
};
