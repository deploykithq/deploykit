/** Pestañas de la página de detalle de un stack. */
type ComposeTabT =
  | "general"
  | "compose"
  | "env"
  | "domains"
  | "deployments"
  | "logs"
  | "terminal"
  | "monitoring";

/** Un contenedor del stack, tal y como lo devuelve `compose.containers`. */
interface ComposeContainerI {
  id: string;
  name: string;
  state: string;
}

interface ComposeTabPropsI {
  composeId: string;
  stack: any;
  canOperate: boolean;
}

interface ContainerSelectorPropsI {
  containers: ComposeContainerI[];
  value: string | null;
  onChange: (containerId: string) => void;
  /** Texto mostrado cuando el stack todavía no tiene contenedores. */
  emptyLabel?: string;
}

interface NewComposeModalPropsI {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export type {
  ComposeTabT,
  ComposeContainerI,
  ComposeTabPropsI,
  ContainerSelectorPropsI,
  NewComposeModalPropsI,
};
