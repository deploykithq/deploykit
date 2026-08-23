import type { DatabaseType } from "@deploykit/shared";

import type { CHANNEL_TYPES } from "@project/infrastructure/ui/constants/project.constants";

type SourceTypeT = "github" | "gitlab" | "git" | "docker_image";

type BuildTypeT = "nixpacks" | "dockerfile" | "buildpacks";

type ChannelTypeT = keyof typeof CHANNEL_TYPES;

interface EditableChannelI {
  id: string;
  name: string;
  type: string;
  config: Record<string, string>;
  events: string[];
}

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

export type {
  SourceTypeT,
  BuildTypeT,
  ChannelTypeT,
  EditableChannelI,
  AppDomainI,
  ApplicationI,
  ProjectDatabaseI,
  ProjectI,
};
