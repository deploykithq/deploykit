import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { execSync, execFile } from "child_process";

import { databases } from "../db/schema/index";

import { getDockerForServer } from "../services/docker-factory";
import { router, protectedProcedure } from "../trpc";

import {
  getProjectRole,
  getProjectRoleByDbId,
  canOperate,
  isAdmin,
  canViewSecrets,
} from "../lib/permissions";
import { backupQueue } from "../lib/redis";
import { logAction } from "../lib/audit/audit";
import { generatePassword, encrypt, decrypt } from "../lib/encryption";

import { createDatabaseSchema, DATABASE_IMAGES } from "@deploykit/shared";

import type { DatabaseType } from "@deploykit/shared";

export const databaseRouter = router({
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      if (!db)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });

      const projectRole = await getProjectRole(ctx.user, db.projectId);
      if (!projectRole)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });

      const canView = canViewSecrets(projectRole);
      let connectionString = "";

      if (canView) {
        const password = db.dbPassword ? decrypt(db.dbPassword) : "";
        connectionString = buildConnectionString(
          db.type as DatabaseType,
          db.name,
          db.internalPort,
          db.dbUser || "",
          password,
          db.databaseName || "",
          db.replicaSet,
        );
      }

      return {
        ...db,
        connectionString,
        dbPassword: "••••••••",
        canViewSecrets: canView,
        projectRole,
      };
    }),

  create: protectedProcedure
    .input(createDatabaseSchema)
    .mutation(async ({ ctx, input }) => {
      const createRole = await getProjectRole(ctx.user, input.projectId);

      if (!canOperate(createRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      const imageConfig = DATABASE_IMAGES[input.type];
      const password = generatePassword();
      const containerName = `dk-${input.name}`;

      // Resolve docker service (local or remote based on serverId)
      const { docker: dockerService } = await getDockerForServer(
        input.serverId,
      );

      const enableReplicaSet = input.type === "mongodb" && input.replicaSet;

      // Create DB record
      const [database] = await ctx.db
        .insert(databases)
        .values({
          projectId: input.projectId,
          name: input.name,
          type: input.type,
          version: input.version || imageConfig.image.split(":")[1],
          internalPort: imageConfig.defaultPort,
          dbUser: input.type === "redis" ? undefined : "admin",
          dbPassword: input.type === "redis" ? undefined : encrypt(password),
          databaseName: input.type === "redis" ? undefined : input.name,
          serverId: input.serverId,
          replicaSet: enableReplicaSet,
        })
        .returning();

      // Build env vars
      const env = buildDbEnv(input.type, password, input.name);

      // Pull image + create and start container (works on both local and remote)
      try {
        await dockerService.pullImage(imageConfig.image);
      } catch {
        // Image might already exist locally
      }

      const containerId = await dockerService.createAndStart({
        name: containerName,
        image: imageConfig.image,
        env,
        networkName: "deploykit-network",
        volumes: [`dk-${input.name}-data:${getDataPath(input.type)}`],
        labels: {
          "deploykit.managed": "true",
          "deploykit.type": "database",
          "deploykit.project": input.projectId,
          "deploykit.service": database!.id,
        },
        ...(enableReplicaSet && {
          command: [
            "bash",
            "-c",
            "[ -f /data/db/replica.key ] || openssl rand -base64 756 > /data/db/replica.key; " +
              "chmod 400 /data/db/replica.key; chown 999:999 /data/db/replica.key; " +
              "exec docker-entrypoint.sh mongod --replSet rs0 --keyFile /data/db/replica.key --bind_ip_all",
          ],
        }),
      });

      // Initialize the replica set after container is running
      if (enableReplicaSet) await initMongoReplicaSet(containerName, password);

      // Update record with container ID
      await ctx.db
        .update(databases)
        .set({ containerId, status: "running" })
        .where(eq(databases.id, database!.id));

      const connectionString = buildConnectionString(
        input.type,
        containerName,
        imageConfig.defaultPort,
        "admin",
        password,
        input.name,
        enableReplicaSet,
      );

      await logAction(ctx, {
        action: "database.create",
        resourceType: "database",
        resourceId: database!.id,
        resourceName: database!.name,
        metadata: { type: input.type, projectId: input.projectId },
      });

      return { ...database!, connectionString, generatedPassword: password };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      if (!database)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });

      const deleteRole = await getProjectRole(ctx.user, database.projectId);

      if (!isAdmin(deleteRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required for this project",
        });

      if (database.containerId) {
        try {
          const { docker } = await getDockerForServer(database.serverId);
          await docker.stopAndRemove(database.containerId);
        } catch {
          // Container might not exist
        }
      }

      await ctx.db.delete(databases).where(eq(databases.id, input.id));

      await logAction(ctx, {
        action: "database.delete",
        resourceType: "database",
        resourceId: input.id,
        resourceName: database?.name,
        metadata: { type: database?.type },
      });

      return { success: true };
    }),

  start: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      if (!database?.containerId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No running container",
        });

      const startRole = await getProjectRole(ctx.user, database.projectId);

      if (!canOperate(startRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      const { docker } = await getDockerForServer(database.serverId);

      await docker.start(database.containerId);

      await ctx.db
        .update(databases)
        .set({ status: "running" })
        .where(eq(databases.id, input.id));

      await logAction(ctx, {
        action: "database.restart",
        resourceType: "database",
        resourceId: database.id,
        resourceName: database.name,
      });

      return { success: true };
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      if (!database?.containerId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No running container",
        });

      const stopRole = await getProjectRole(ctx.user, database.projectId);

      if (!canOperate(stopRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      const { docker } = await getDockerForServer(database.serverId);

      await docker.stop(database.containerId);

      await ctx.db
        .update(databases)
        .set({ status: "stopped" })
        .where(eq(databases.id, input.id));

      await logAction(ctx, {
        action: "database.stop",
        resourceType: "database",
        resourceId: database.id,
        resourceName: database.name,
      });

      return { success: true };
    }),

  stats: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      // Authorization: only project members may read live stats.
      const role = database
        ? await getProjectRole(ctx.user, database.projectId)
        : null;

      if (!database || !role)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });

      if (!database.containerId) return null;

      try {
        const { docker } = await getDockerForServer(database.serverId);
        return await docker.getStats(database.containerId);
      } catch {
        return null;
      }
    }),

  updateBackupConfig: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        backupEnabled: z.boolean(),
        backupCron: z.string().max(100).optional(),
        backupRetention: z.number().int().min(1).max(365).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const backupRole = await getProjectRoleByDbId(ctx.user, id);
      if (!canOperate(backupRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      const [database] = await ctx.db
        .update(databases)
        .set(data)
        .where(eq(databases.id, id))
        .returning();

      await logAction(ctx, {
        action: "database.update_backup_config",
        resourceType: "database",
        resourceId: database!.id,
        resourceName: database!.name,
        metadata: data,
      });

      return database!;
    }),

  triggerBackup: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      if (!database)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });

      const triggerRole = await getProjectRole(ctx.user, database.projectId);
      if (!canOperate(triggerRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      await backupQueue.add("backup", { databaseId: database.id });

      await logAction(ctx, {
        action: "database.backup",
        resourceType: "database",
        resourceId: database.id,
        resourceName: database.name,
        metadata: { manual: true },
      });

      return { success: true };
    }),

  listBackups: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      // Authorization: backup listings are restricted to project members.
      const role = database
        ? await getProjectRole(ctx.user, database.projectId)
        : null;

      if (!database || !role)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });

      const backupDir = `/var/backups/deploykit/${database.name}`;

      try {
        if (!fs.existsSync(backupDir)) return [];
        const files = fs.readdirSync(backupDir);

        return files
          .map((filename) => {
            const filePath = path.join(backupDir, filename);
            const stat = fs.statSync(filePath);
            return {
              filename,
              size: stat.size,
              createdAt: stat.mtime.toISOString(),
            };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      } catch {
        return [];
      }
    }),

  deleteBackup: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        filename: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      if (!database)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });

      const delBackupRole = await getProjectRole(ctx.user, database.projectId);
      if (!canOperate(delBackupRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      const filePath = path.join(
        `/var/backups/deploykit/${database.name}`,
        path.basename(input.filename), // prevent path traversal
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return { success: true };
    }),

  restoreBackup: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        filename: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
      });

      if (!database)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });

      const restoreRole = await getProjectRole(ctx.user, database.projectId);
      if (!canOperate(restoreRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      const filePath = path.join(
        `/var/backups/deploykit/${database.name}`,
        path.basename(input.filename),
      );

      if (!fs.existsSync(filePath)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup file not found",
        });
      }

      const containerName = `dk-${database.name}`;

      await runRestore(
        database.type as DatabaseType,
        containerName,
        filePath,
        database.dbUser || "admin",
        database.databaseName || database.name,
      );

      await logAction(ctx, {
        action: "database.restore",
        resourceType: "database",
        resourceId: database.id,
        resourceName: database.name,
        metadata: { filename: input.filename, type: database.type },
      });

      return { success: true };
    }),
});

const buildDbEnv = (
  type: DatabaseType,
  password: string,
  dbName: string,
): string[] => {
  switch (type) {
    case "postgresql":
      return [
        `POSTGRES_USER=admin`,
        `POSTGRES_PASSWORD=${password}`,
        `POSTGRES_DB=${dbName}`,
      ];
    case "mongodb":
      return [
        `MONGO_INITDB_ROOT_USERNAME=admin`,
        `MONGO_INITDB_ROOT_PASSWORD=${password}`,
        `MONGO_INITDB_DATABASE=${dbName}`,
      ];
    case "mysql":
      return [
        `MYSQL_ROOT_PASSWORD=${password}`,
        `MYSQL_USER=admin`,
        `MYSQL_PASSWORD=${password}`,
        `MYSQL_DATABASE=${dbName}`,
      ];
    case "mariadb":
      return [
        `MARIADB_ROOT_PASSWORD=${password}`,
        `MARIADB_USER=admin`,
        `MARIADB_PASSWORD=${password}`,
        `MARIADB_DATABASE=${dbName}`,
      ];
    case "redis":
      return [];
  }
};

const getDataPath = (type: DatabaseType): string => {
  switch (type) {
    case "postgresql":
      return "/var/lib/postgresql/data";
    case "mongodb":
      return "/data/db";
    case "mysql":
      return "/var/lib/mysql";
    case "mariadb":
      return "/var/lib/mysql";
    case "redis":
      return "/data";
  }
};

const buildConnectionString = (
  type: DatabaseType,
  host: string,
  port: number,
  user: string,
  password: string,
  dbName: string,
  replicaSet?: boolean,
): string => {
  switch (type) {
    case "postgresql":
      return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
    case "mongodb": {
      const params = ["authSource=admin"];
      if (replicaSet) params.push("replicaSet=rs0");
      return `mongodb://${user}:${password}@${host}:${port}/${dbName}?${params.join("&")}`;
    }
    case "mysql":
    case "mariadb":
      return `mysql://${user}:${password}@${host}:${port}/${dbName}`;
    case "redis":
      return `redis://${host}:${port}`;
  }
};

/**
 * Sanitize a string for safe use in shell commands.
 * Only allows alphanumeric, dash, underscore, dot, and forward slash.
 */
const shellSafe = (str: string): string => {
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(str)) {
    throw new Error(`Unsafe shell argument: ${str}`);
  }
  return str;
};

/**
 * Shell-escape a string by wrapping in single quotes (POSIX-safe).
 */
const shellEscape = (str: string): string =>
  "'" + str.replace(/'/g, "'\"'\"'") + "'";

/**
 * Wait for MongoDB to be ready and initialize the replica set.
 * Uses `mongosh` (available in mongo:7+) to run rs.initiate().
 * Password is passed via shell escaping to prevent injection.
 */
const initMongoReplicaSet = (
  containerName: string,
  password: string,
): Promise<void> => {
  const c = shellSafe(containerName);
  // Retry up to 10 times — the entrypoint generates the keyfile, creates users,
  // then starts mongod, which can take 15-20 seconds on first boot.
  const cmd =
    `for i in $(seq 1 10); do docker exec ${c} mongosh -u admin` +
    ` -p ${shellEscape(password)} --authenticationDatabase admin` +
    ` --quiet --eval "rs.initiate()" && break || sleep 3; done`;

  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", cmd], { timeout: 60_000 }, (error) => {
      if (error)
        return reject(
          new Error(`Failed to initiate replica set: ${error.message}`),
        );
      resolve();
    });
  });
};

const runRestore = (
  type: DatabaseType,
  containerName: string,
  filePath: string,
  user: string,
  dbName: string,
): void => {
  // Sanitize all values before passing to shell
  const c = shellSafe(containerName);
  const f = shellSafe(filePath);
  const u = shellSafe(user);
  const d = shellSafe(dbName);

  switch (type) {
    case "postgresql":
      execSync(`gunzip -c ${f} | docker exec -i ${c} psql -U ${u} -d ${d}`, {
        timeout: 300_000,
      });
      break;
    case "mongodb":
      execSync(
        `cat ${f} | docker exec -i ${c} mongorestore --archive --gzip --drop`,
        { timeout: 300_000 },
      );
      break;
    case "mysql":
    case "mariadb":
      execSync(`gunzip -c ${f} | docker exec -i ${c} mysql -u ${u} ${d}`, {
        timeout: 300_000,
      });
      break;
    case "redis":
      execSync(`docker cp ${f} ${c}:/data/dump.rdb`);
      execSync(`docker restart ${c}`);
      break;
  }
};
