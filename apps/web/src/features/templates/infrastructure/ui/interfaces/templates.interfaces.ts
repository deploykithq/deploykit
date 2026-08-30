import type { TemplateMetaT } from "@deploykit/shared";

/**
 * Una entrada del catálogo tal y como la sirve la API: los metadatos del
 * blueprint más la URL ya resuelta de su logo (que depende de si viene del
 * registro remoto o del catálogo embebido).
 */
type CatalogEntryT = TemplateMetaT & { logoUrl?: string };

/** De dónde salió el catálogo que se está mostrando. */
type CatalogSourceT = "remote" | "bundled";

interface DeployedDomainI {
  host: string;
  https: boolean;
}

interface DeployResultI {
  composeServiceId: string;
  projectId: string;
  name: string;
  deploymentId: string;
  domains: DeployedDomainI[];
  /** Credenciales generadas: se muestran una sola vez, aquí. */
  secrets: Record<string, string>;
}

interface DeployTemplateModalPropsI {
  template: CatalogEntryT | null;
  open: boolean;
  onClose: () => void;
  /** Preselect a project (e.g. when launched from a project page). */
  projectId?: string;
}

interface DeployResultViewPropsI {
  result: DeployResultI;
  onGoToStack: (projectId: string, composeServiceId: string) => void;
}

interface TemplateCardPropsI {
  template: CatalogEntryT;
  onDeploy: (template: CatalogEntryT) => void;
}

export type {
  CatalogEntryT,
  CatalogSourceT,
  DeployedDomainI,
  DeployResultI,
  DeployTemplateModalPropsI,
  DeployResultViewPropsI,
  TemplateCardPropsI,
};
