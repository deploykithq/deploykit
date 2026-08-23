import {
  Box,
  Database,
  FolderKanban,
  Server,
  Rocket,
  XCircle,
  AlertTriangle,
  ArrowUpRight,
  Activity,
  Zap,
  CheckCircle2,
  Loader2,
  Clock,
} from "lucide-react";

const ACTION_CONFIG: Record<
  string,
  { label: string; icon: any; color: string }
> = {
  "application.deploy": {
    label: "deployed",
    icon: Rocket,
    color: "text-accent",
  },
  "application.create": {
    label: "created app",
    icon: Box,
    color: "text-green-400",
  },
  "application.delete": {
    label: "deleted app",
    icon: XCircle,
    color: "text-danger",
  },
  "application.stop": {
    label: "stopped",
    icon: AlertTriangle,
    color: "text-warning",
  },
  "application.restart": {
    label: "restarted",
    icon: Zap,
    color: "text-accent",
  },
  "application.update": {
    label: "updated app",
    icon: Box,
    color: "text-text-secondary",
  },
  "application.update_env": {
    label: "updated env vars",
    icon: Box,
    color: "text-text-secondary",
  },
  "application.add_domain": {
    label: "added domain",
    icon: ArrowUpRight,
    color: "text-green-400",
  },
  "database.create": {
    label: "created database",
    icon: Database,
    color: "text-green-400",
  },
  "database.delete": {
    label: "deleted database",
    icon: XCircle,
    color: "text-danger",
  },
  "database.backup": {
    label: "triggered backup",
    icon: Database,
    color: "text-accent",
  },
  "project.create": {
    label: "created project",
    icon: FolderKanban,
    color: "text-green-400",
  },
  "project.delete": {
    label: "deleted project",
    icon: XCircle,
    color: "text-danger",
  },
  "server.create": {
    label: "added server",
    icon: Server,
    color: "text-green-400",
  },
  "auth.login": {
    label: "logged in",
    icon: Activity,
    color: "text-text-muted",
  },
};

const DEPLOY_STATUS_ICON: Record<string, any> = {
  success: CheckCircle2,
  failed: XCircle,
  building: Loader2,
  deploying: Loader2,
  queued: Clock,
  cancelled: XCircle,
};

const DEPLOY_STATUS_COLOR: Record<string, string> = {
  success: "text-green-400",
  failed: "text-danger",
  building: "text-warning animate-spin",
  deploying: "text-accent animate-spin",
  queued: "text-text-muted",
  cancelled: "text-text-muted",
};

const APP_STATUS_DOT: Record<string, string> = {
  running: "bg-green-400",
  building: "bg-yellow-400",
  deploying: "bg-yellow-400",
  error: "bg-red-400",
  stopped: "bg-neutral-500",
  idle: "bg-neutral-500",
};

const ACCENT_STYLES = {
  default: "bg-surface-2 text-text-muted",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning",
};

/** Cada cuánto se refresca el resumen del dashboard. */
const DASHBOARD_REFETCH_MS = 30_000;

export {
  ACTION_CONFIG,
  DEPLOY_STATUS_ICON,
  DEPLOY_STATUS_COLOR,
  APP_STATUS_DOT,
  ACCENT_STYLES,
  DASHBOARD_REFETCH_MS,
};
