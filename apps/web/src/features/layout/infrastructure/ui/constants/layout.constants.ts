import {
  LayoutDashboard,
  FolderKanban,
  Server,
  KeyRound,
  Settings,
  Users,
  Shield,
  Bell,
  LayoutGrid,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/projects", label: "Projects", icon: FolderKanban, exact: false },
  { to: "/templates", label: "Templates", icon: LayoutGrid, exact: true },
  { to: "/servers", label: "Servers", icon: Server, exact: true },
  {
    to: "/ssh-keys",
    label: "SSH Keys",
    icon: KeyRound,
    exact: true,
    adminOnly: true,
  },
  { to: "/alerts", label: "Alerts", icon: Bell, exact: true },
  { to: "/users", label: "Users", icon: Users, exact: true, adminOnly: true },
  {
    to: "/audit-log",
    label: "Audit Log",
    icon: Shield,
    exact: true,
    adminOnly: true,
  },
  { to: "/settings", label: "Settings", icon: Settings, exact: true },
];

const BASE_CLASS =
  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-text-secondary hover:text-text-primary hover:bg-surface-2";
const ACTIVE_CLASS =
  "bg-accent-muted text-accent-hover font-medium hover:bg-accent-muted hover:text-accent-hover";
const SIDEBAR_WIDTH = "w-60";

export { NAV_ITEMS, BASE_CLASS, ACTIVE_CLASS, SIDEBAR_WIDTH };
