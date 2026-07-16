import {
  BarChart3,
  GitBranch,
  Globe,
  History,
  Key,
  Settings,
  Terminal,
  TerminalSquare,
  ShieldCheck,
} from "lucide-react";

import type { TabT } from "@application/infrastructure/ui/types/application.module.types";

const STATUS_ICONS: Record<string, string> = {
  queued: "⏳",
  building: "🔨",
  deploying: "🚀",
  success: "✓",
  failed: "✗",
  cancelled: "⊘",
};

const TABS: { id: TabT; label: string; icon: any }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "env", label: "Environment", icon: Key },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "deployments", label: "Deployments", icon: History },
  { id: "logs", label: "Logs", icon: Terminal },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "monitoring", label: "Monitoring", icon: BarChart3 },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "previews", label: "Previews", icon: GitBranch },
];

export { STATUS_ICONS, TABS };
