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

import type { TabT } from "@application/infrastructure/ui/interfaces/application.interfaces";

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

/** Cada cuánto se refrescan las alertas abiertas de la aplicación. */
const ALERTS_REFETCH_MS = 30_000;

/** Cada cuánto se refresca la lista de preview deployments. */
const PREVIEWS_REFETCH_MS = 15_000;

/** Líneas de log de contenedor que se piden de golpe. */
const LOGS_TAIL = 200;

/** Cuánto se muestra el "Saved" tras guardar variables de entorno. */
const SAVED_FEEDBACK_MS = 2000;

/** Cada cuánto se sondea el estado de las instancias (réplicas). */
const INSTANCES_REFETCH_MS = 8000;

/** Sondeo de la aplicación mientras está construyendo o desplegando. */
const DEPLOYING_REFETCH_MS = 3000;

export {
  STATUS_ICONS,
  TABS,
  ALERTS_REFETCH_MS,
  PREVIEWS_REFETCH_MS,
  LOGS_TAIL,
  SAVED_FEEDBACK_MS,
  INSTANCES_REFETCH_MS,
  DEPLOYING_REFETCH_MS,
};
