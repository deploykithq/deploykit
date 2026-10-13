import {
  BarChart3,
  FolderOpen,
  HardDrive,
  Info,
  Puzzle,
  ScrollText,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";

import type { GameServerTabT } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

const TABS: { id: GameServerTabT; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: Info },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
  { id: "console", label: "Console", icon: TerminalSquare },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "mods", label: "Mods", icon: Puzzle },
  { id: "backups", label: "Backups", icon: HardDrive },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "monitoring", label: "Monitoring", icon: BarChart3 },
];

/** Statuses the worker moves out of by itself: the page polls through them. */
const TRANSITIONAL_STATUSES = ["provisioning", "restoring"];

/** Polling while the server is provisioning / restoring. */
const STATUS_POLL_MS = 3000;

/** Polling of the backup list while a backup is queued or running. */
const BACKUPS_POLL_MS = 3000;

const CRON_PRESETS = [
  { value: "0 4 * * *", label: "Daily at 4:00 AM" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 */12 * * *", label: "Every 12 hours" },
  { value: "0 0 * * 0", label: "Weekly (Sunday midnight)" },
  { value: "0 0 1 * *", label: "Monthly (1st at midnight)" },
];

const DEFAULT_BACKUP_CRON = "0 4 * * *";

/** Default number of archives kept: worlds are large. */
const DEFAULT_BACKUP_RETENTION = 7;

/** How the API masks a secret the caller may not read. */
const SECRET_MASK = "••••••••";

const SAVED_FEEDBACK_MS = 2500;

/** Commands remembered for ↑/↓ in the console. */
const CONSOLE_HISTORY_MAX = 50;

/** Memory slider bounds; the API accepts 256 MB – 64 GB. */
const MEMORY_STEP_MB = 256;
const MEMORY_SLIDER_MAX_MB = 32768;

/** Files larger than this are downloaded instead of opened in the editor. */
const EDITABLE_MAX_BYTES = 1024 * 1024;

/** Same palette as the web terminal, so both consoles look alike. */
const XTERM_THEME = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#0d1117",
  selectionBackground: "#264f78",
  black: "#0d1117",
  red: "#ff7b72",
  green: "#7ee787",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#76e3ea",
  white: "#c9d1d9",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#aff5b4",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#a5d6ff",
  brightWhite: "#f0f6fc",
};

const BACKUP_TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Scheduled",
  "pre-restore": "Before restore",
  "pre-mods": "Before mod change",
};

const MOD_SOURCE_LABELS: Record<string, string> = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  "steam-workshop": "Steam Workshop",
};

/** Wait this long after typing before searching a catalogue. */
const MOD_SEARCH_DEBOUNCE_MS = 350;

export {
  TABS,
  TRANSITIONAL_STATUSES,
  STATUS_POLL_MS,
  BACKUPS_POLL_MS,
  CRON_PRESETS,
  DEFAULT_BACKUP_CRON,
  DEFAULT_BACKUP_RETENTION,
  SECRET_MASK,
  SAVED_FEEDBACK_MS,
  CONSOLE_HISTORY_MAX,
  MEMORY_STEP_MB,
  MEMORY_SLIDER_MAX_MB,
  EDITABLE_MAX_BYTES,
  XTERM_THEME,
  BACKUP_TRIGGER_LABELS,
  MOD_SOURCE_LABELS,
  MOD_SEARCH_DEBOUNCE_MS,
};
