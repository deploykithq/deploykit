interface DashboardStatsI {
  projects: number;
  applications: number;
  appsRunning: number;
  appsError: number;
  appsBuilding: number;
  databases: number;
  dbsRunning: number;
  servers: number;
  serversConnected: number;
  openAlerts: number;
  deploys24h: number;
  deploys7d: number;
}

interface DashboardDeployI {
  id: string;
  status: string;
  commitHash: string | null;
  commitMessage: string | null;
  createdAt: string;
  application: {
    id: string;
    name: string;
    projectId: string;
  } | null;
}

interface DashboardActivityI {
  id: string;
  userEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceName: string | null;
  createdAt: string;
}

interface DashboardServerI {
  id: string;
  name: string;
  host: string;
  status: string;
  isLocal: boolean;
  totalCpu: number | null;
  totalMemory: number | null;
  totalDisk: number | null;
  dockerVersion: string | null;
  lastHealthCheck: string | null;
}

interface DashboardProjectI {
  id: string;
  name: string;
  applications: Array<{ id: string; name: string; status: string }>;
  databases: Array<{ id: string; name: string; status: string; type: string }>;
}

export type {
  DashboardStatsI,
  DashboardDeployI,
  DashboardActivityI,
  DashboardServerI,
  DashboardProjectI,
};
