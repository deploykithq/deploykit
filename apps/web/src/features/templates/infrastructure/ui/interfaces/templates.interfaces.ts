import type { Template } from "@deploykit/shared";

interface DeployedApplicationI {
  id: string;
  name: string;
  deployed: boolean;
}

interface DeployedDatabaseI {
  id: string;
  name: string;
  connectionString: string;
}

interface DeployResultI {
  projectId: string;
  primaryApplicationId: string | null;
  applications: DeployedApplicationI[];
  databases: DeployedDatabaseI[];
}

interface DeployTemplateModalPropsI {
  template: Template | null;
  open: boolean;
  onClose: () => void;
  /** Preselect a project (e.g. when launched from a project page). */
  projectId?: string;
}

interface DeployResultViewPropsI {
  result: DeployResultI;
  onGoToApp: (projectId: string, appId: string) => void;
  onGoToProject: (projectId: string) => void;
}

export type {
  DeployedApplicationI,
  DeployedDatabaseI,
  DeployResultI,
  DeployTemplateModalPropsI,
  DeployResultViewPropsI,
};
