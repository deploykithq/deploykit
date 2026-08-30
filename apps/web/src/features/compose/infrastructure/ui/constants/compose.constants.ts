import {
  BarChart3,
  FileCode2,
  Globe,
  History,
  Key,
  Settings,
  Terminal,
  TerminalSquare,
} from "lucide-react";

import type { ComposeTabT } from "@compose/infrastructure/ui/interfaces/compose.interfaces";

const TABS: { id: ComposeTabT; label: string; icon: any }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "compose", label: "Compose", icon: FileCode2 },
  { id: "env", label: "Environment", icon: Key },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "deployments", label: "Deployments", icon: History },
  { id: "logs", label: "Logs", icon: Terminal },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "monitoring", label: "Monitoring", icon: BarChart3 },
];

/** Sondeo del stack mientras despliega. */
const DEPLOYING_REFETCH_MS = 3000;

/** Sondeo de la lista de contenedores: Compose los recrea sin avisar. */
const CONTAINERS_REFETCH_MS = 8000;

/** Líneas de log de contenedor que se piden de golpe. */
const LOGS_TAIL = 200;

/** Cuánto se muestra el "Saved" tras guardar. */
const SAVED_FEEDBACK_MS = 2000;

/** Plantilla de arranque del modal "nuevo stack". */
const COMPOSE_PLACEHOLDER = `services:
  app:
    image: nginx:alpine
    restart: unless-stopped
    expose:
      - "80"
`;

export {
  TABS,
  DEPLOYING_REFETCH_MS,
  CONTAINERS_REFETCH_MS,
  LOGS_TAIL,
  SAVED_FEEDBACK_MS,
  COMPOSE_PLACEHOLDER,
};
