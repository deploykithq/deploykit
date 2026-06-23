import { Worker, type Job } from "bullmq";
import { execFile } from "child_process";
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from "fs";
import path from "path";

import { db } from "../db/index";
import { databases } from "../db/schema/index";
import { decrypt } from "../lib/encryption";
import { shellEscape, validateShellArg } from "../lib/shell";
import { redis } from "../lib/redis";
import { fireNotification } from "../services/notifier";
import type { DatabaseType } from "@deploykit/shared";

const BACKUP_DIR = "/var/backups/deploykit";

interface BackupJobData {
  databaseId: string;
}

const startBackupWorker = () => {
  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const worker = new Worker<BackupJobData>(
    "backup",
    async (job: Job<BackupJobData>) => {
      const { databaseId } = job.data;

      const database = await db.query.databases.findFirst({
        where: eq(databases.id, databaseId),
      });

      if (!database) throw new Error("Database not found");
      if (!database.containerId)
        throw new Error("Database has no running container");

      const password = database.dbPassword ? decrypt(database.dbPassword) : "";
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${database.name}_${timestamp}`;
      const backupPath = path.join(BACKUP_DIR, database.name);

      if (!existsSync(backupPath)) {
        mkdirSync(backupPath, { recursive: true });
      }

      const type = database.type as DatabaseType;
      const containerName = `dk-${database.name}`;

      console.log(`[backup] Starting backup for ${database.name} (${type})`);

      await runBackup(
        type,
        containerName,
        password,
        database.databaseName || "",
        backupPath,
        filename,
      );

      // Cleanup old backups (retention)
      cleanupOldBackups(backupPath, database.backupRetention);

      console.log(`[backup] Backup completed for ${database.name}`);

      // Notify success
      fireNotification({
        event: "backup.completed",
        projectId: database.projectId,
        title: `Backup completed: ${database.name}`,
        message: `Database backup for "${database.name}" (${type}) completed successfully.`,
        meta: {
          databaseId: database.id,
          databaseName: database.name,
        },
      }).catch(() => {}); // fire-and-forget
    },
    {
      connection: redis,
      concurrency: 1,
    },
  );

  worker.on("failed", async (job, err) => {
    console.error(`[backup-worker] Job ${job?.id} failed:`, err.message);

    // Look up database to send failure notification
    if (job?.data?.databaseId) {
      try {
        const database = await db.query.databases.findFirst({
          where: eq(databases.id, job.data.databaseId),
        });
        if (database) {
          fireNotification({
            event: "backup.failed",
            projectId: database.projectId,
            title: `Backup failed: ${database.name}`,
            message: `Database backup for "${database.name}" failed: ${err.message}`,
            meta: {
              databaseId: database.id,
              databaseName: database.name,
              error: err.message,
            },
          }).catch(() => {});
        }
      } catch {
        // Notification failure is non-fatal
      }
    }
  });

  console.log("[backup-worker] Worker started");
  return worker;
};


const runBackup = (
  type: DatabaseType,
  containerName: string,
  password: string,
  dbName: string,
  backupPath: string,
  filename: string,
): Promise<void> => {
  // Validate container and db names to prevent injection in non-escaped positions
  const safeContainer = validateShellArg(containerName);
  const safeDbName = validateShellArg(dbName);

  let cmd: string;
  // Pass the password via the process environment and let `docker exec -e VAR`
  // (no =value) forward it — it never appears on any host command line, so
  // it can't be read from `ps` output or process listings
  const env = { ...process.env, MONGO_PWD: password, MYSQL_PWD: password };

  switch (type) {
    case "postgresql":
      cmd =
        `docker exec ${safeContainer} pg_dump -U admin -d ${safeDbName}` +
        ` | gzip > ${shellEscape(path.join(backupPath, `${filename}.sql.gz`))}`;
      break;
    case "mongodb":
      // Single quotes around the inner command so "$MONGO_PWD" is expanded by
      // the shell inside the container, not by the host shell
      cmd =
        `docker exec -e MONGO_PWD ${safeContainer}` +
        ` sh -c 'mongodump --username admin --password "$MONGO_PWD"` +
        ` --authenticationDatabase admin --db ${safeDbName} --archive --gzip'` +
        ` > ${shellEscape(path.join(backupPath, `${filename}.archive.gz`))}`;
      break;
    case "mysql":
    case "mariadb":
      // mysqldump reads MYSQL_PWD from its environment directly
      cmd =
        `docker exec -e MYSQL_PWD ${safeContainer}` +
        ` mysqldump -u admin ${safeDbName}` +
        ` | gzip > ${shellEscape(path.join(backupPath, `${filename}.sql.gz`))}`;
      break;
    case "redis":
      cmd =
        `docker exec ${safeContainer} redis-cli BGSAVE && sleep 2` +
        ` && docker cp ${safeContainer}:/data/dump.rdb ${shellEscape(path.join(backupPath, `${filename}.rdb`))}`;
      break;
    default:
      throw new Error(`Unsupported database type for backup: ${type}`);
  }

  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", cmd], { timeout: 300_000, env }, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
};

function cleanupOldBackups(backupPath: string, retentionDays: number): void {
  if (!existsSync(backupPath)) return;

  const now = Date.now();
  const maxAge = retentionDays * 24 * 60 * 60 * 1000;

  const files = readdirSync(backupPath);
  for (const file of files) {
    const filePath = path.join(backupPath, file);
    const stat = statSync(filePath);
    if (now - stat.mtimeMs > maxAge) {
      unlinkSync(filePath);
      console.log(`[backup] Cleaned up old backup: ${file}`);
    }
  }
}

export { startBackupWorker };
