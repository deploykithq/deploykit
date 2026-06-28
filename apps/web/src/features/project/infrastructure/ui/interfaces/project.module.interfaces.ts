import type { DatabaseType } from "@deploykit/shared";
import type { SourceTypeT } from "@project/infrastructure/ui/types/project.module.types";

interface AppDomainI {
  domain: string;
}

interface ApplicationI {
  id: string;
  name: string;
  status: string;
  sourceType: SourceTypeT;
  branch?: string;
  domains?: AppDomainI[];
  statusPageVisible?: boolean;
  updatedAt: string | Date;
}

interface ProjectDatabaseI {
  id: string;
  name: string;
  type: DatabaseType;
  status: string;
  version?: string;
  internalPort: number;
  updatedAt: string | Date;
}

interface ProjectI {
  id: string;
  name: string;
  description?: string;
  statusPageEnabled?: boolean;
  statusPageSlug?: string | null;
  statusPageTitle?: string | null;
  applications: ApplicationI[];
  databases: ProjectDatabaseI[];
}

export type { AppDomainI, ApplicationI, ProjectDatabaseI, ProjectI };
