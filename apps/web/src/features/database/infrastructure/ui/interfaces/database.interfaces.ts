type DatabaseStatusT = "running" | "stopped" | "error" | string;

type DatabaseTypeT = "postgresql" | "mongodb" | "redis" | "mysql" | "mariadb";

type TabT = "connection" | "backups" | "monitoring" | "logs";

interface DatabaseI {
  id: string;
  name: string;
  type: DatabaseTypeT;
  status: DatabaseStatusT;
  version?: string;
  internalPort: number;
  containerId?: string;
  connectionString?: string;
  dbUser?: string;
  replicaSet: boolean;
  backupEnabled: boolean;
  backupCron?: string;
  backupRetention?: number;
}

interface BackupI {
  filename: string;
  size: number;
  createdAt: string | Date;
}

interface DatabaseStatsI {
  cpu: number;
  memory: {
    used: number;
    total: number;
    percent: number;
  };
}

export type {
  DatabaseStatusT,
  DatabaseTypeT,
  TabT,
  DatabaseI,
  BackupI,
  DatabaseStatsI,
};
