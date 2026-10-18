import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  createGameServerSchema,
  gameBackupConfigSchema,
  gameConsoleCommandSchema,
  updateGameServerSchema,
} from "@deploykit/shared";

import { gameServers, gameServerBackups } from "../db/schema/index";
import { router, protectedProcedure, operatorProcedure, adminProcedure } from "../trpc";
import {
  getProjectRole,
  canOperate,
  canViewSecrets,
} from "../lib/permissions";
import { logAction } from "../lib/audit/audit";
import { assertValidCron } from "../lib/cron";
import { gameBackupQueue, isRateLimited } from "../lib/redis";
import {
  upsertGameBackupSchedule,
  removeGameBackupSchedule,
} from "../lib/task-scheduler";
import { getDockerForServer } from "../services/docker-factory";
import { getGame, listGames, refreshGameCatalog } from "../services/game-catalog";
import { sendConsoleCommand } from "../services/game-console";
import {
  deletePath,
  listFiles,
  makeDirectory,
  readFile,
  renamePath,
  writeFile,
} from "../services/game-files";
import {
  connectInfo,
  createGameServer,
  gameBackupDir,
  loadGameServerPorts,
  readSecrets,
  removeGameServer,
  restartGameServer,
  startGameServer,
  stopGameServer,
  updateGameServer,
} from "../services/game-server";

import { guarded, MESSAGES, resolveServer } from "./game-server-access";
import { gameServerModsRouter } from "./game-server-mods";

import type { UserRole } from "@deploykit/shared";
import type { GameServerT } from "../db/schema/index";

/**
 * Game servers.
 *
 * Every procedure resolves the caller's project role before it touches Docker
 * or the registry, and answers NOT_FOUND to a non-member so a server's
 * existence is not revealed. FORBIDDEN is only for members who lack the level.
 *
 * Sending a console command and writing files are as powerful as the web
 * terminal (a plugin jar is code the server runs), so they need the global
 * operator role (`operatorProcedure`) AND project `canOperate` — the same rule
 * as scheduled tasks. Reading files and downloads need `canViewSecrets`:
 * config files hold RCON passwords.
 */

const MASK = "••••••••";

/**
 * A server as the web sees it. `secret_config` is never returned; secret
 * values are decrypted only for callers who may view secrets.
 */
const presentServer = async (row: GameServerT, role: UserRole) => {
  const showSecrets = canViewSecrets(role);
  const secrets = readSecrets(row);
  const ports = await loadGameServerPorts(row.id);
  const { secretConfig: _secret, appliedModEnv: _applied, ...rest } = row;

  return {
    ...rest,
    values: {
      ...row.config,
      ...Object.fromEntries(
        Object.entries(secrets).map(([k, v]) => [k, showSecrets ? v : MASK]),
      ),
    },
    ports,
    connect: await connectInfo(ports),
    projectRole: role,
    canViewSecrets: showSecrets,
  };
};

const fileTarget = z.object({
  id: z.string().uuid(),
  volume: z.string().min(1).max(32),
  path: z.string().max(1024),
});

export const gameServerRouter = router({
  mods: gameServerModsRouter,

  catalog: router({
    /** The game catalogue is public registry data; any user may browse it. */
    list: protectedProcedure.query(() => listGames()),

    byId: protectedProcedure
      .input(z.object({ id: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        const game = await getGame(input.id);
        if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
        return game;
      }),

    refresh: adminProcedure.mutation(() => refreshGameCatalog()),
  }),

  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.projectId);
      if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      return ctx.db.query.gameServers.findMany({
        where: eq(gameServers.projectId, input.projectId),
        columns: { secretConfig: false, spec: false, appliedModEnv: false },
        with: { ports: true },
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { row, role } = await resolveServer(ctx, input.id, "view");
      return presentServer(row, role);
    }),

  create: protectedProcedure.input(createGameServerSchema).mutation(async ({ ctx, input }) => {
    const role = await getProjectRole(ctx.user, input.projectId);
    if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    if (!canOperate(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: MESSAGES.operate });
    }

    // A modpack is code the server will run: the same bar as a mod.
    if (input.modpack && ctx.user.role === "viewer") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Starting from a modpack needs the operator role",
      });
    }

    const { row, generatedSecrets } = await guarded(() => createGameServer(input));

    await logAction(ctx, {
      action: "game_server.create",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { gameId: row.gameId, projectId: row.projectId, start: input.start },
    });

    return { id: row.id, name: row.name, status: row.status, generatedSecrets };
  }),

  update: protectedProcedure.input(updateGameServerSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    const result = await guarded(() => updateGameServer(row, input));

    await logAction(ctx, {
      action: "game_server.update",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      // Keys only: values may be secrets.
      metadata: {
        keys: Object.keys(input.values ?? {}),
        ports: input.ports ?? undefined,
        memoryMb: input.memoryMb,
      },
    });
    return result;
  }),

  start: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "operate");
      const result = await guarded(() => startGameServer(row));
      await logAction(ctx, {
        action: "game_server.start",
        resourceType: "game_server",
        resourceId: row.id,
        resourceName: row.name,
      });
      return result;
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "operate");
      await guarded(() => stopGameServer(row));
      await logAction(ctx, {
        action: "game_server.stop",
        resourceType: "game_server",
        resourceId: row.id,
        resourceName: row.name,
      });
      return { success: true };
    }),

  restart: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "operate");
      await guarded(() => restartGameServer(row));
      await logAction(ctx, {
        action: "game_server.restart",
        resourceType: "game_server",
        resourceId: row.id,
        resourceName: row.name,
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), deleteData: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "admin");

      await removeGameBackupSchedule(row.id);
      await removeGameServer(row, input.deleteData);
      await ctx.db.delete(gameServers).where(eq(gameServers.id, row.id));

      await logAction(ctx, {
        action: "game_server.delete",
        resourceType: "game_server",
        resourceId: row.id,
        resourceName: row.name,
        metadata: { gameId: row.gameId, deleteData: input.deleteData },
      });
      return { success: true };
    }),

  stats: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "view");
      if (!row.containerId) return null;
      try {
        const { docker } = await getDockerForServer(null);
        return await docker.getStats(row.containerId);
      } catch {
        return null;
      }
    }),

  consoleSend: operatorProcedure
    .input(gameConsoleCommandSchema)
    .mutation(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "operate");

      if (await isRateLimited(`game-console:${ctx.user.id}:${row.id}`, 20, 10_000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many commands. Slow down.",
        });
      }

      const output = await guarded(() => sendConsoleCommand(row, input.command));

      await logAction(ctx, {
        action: "game_server.console_command",
        resourceType: "game_server",
        resourceId: row.id,
        resourceName: row.name,
        metadata: { command: input.command.slice(0, 200) },
      });
      return { output };
    }),

  files: router({
    list: protectedProcedure.input(fileTarget).query(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "secrets");
      return guarded(() => listFiles(row, input.volume, input.path));
    }),

    read: protectedProcedure.input(fileTarget).query(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "secrets");
      return guarded(() => readFile(row, input.volume, input.path));
    }),

    write: operatorProcedure
      .input(fileTarget.extend({ content: z.string().max(1024 * 1024) }))
      .mutation(async ({ ctx, input }) => {
        const { row } = await resolveServer(ctx, input.id, "operate");
        const result = await guarded(() =>
          writeFile(row, input.volume, input.path, input.content),
        );
        await logAction(ctx, {
          action: "game_server.file_write",
          resourceType: "game_server",
          resourceId: row.id,
          resourceName: row.name,
          metadata: { volume: input.volume, path: input.path, size: result.size },
        });
        return result;
      }),

    mkdir: operatorProcedure
      .input(fileTarget.extend({ name: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        const { row } = await resolveServer(ctx, input.id, "operate");
        await guarded(() => makeDirectory(row, input.volume, input.path, input.name));
        await logAction(ctx, {
          action: "game_server.file_mkdir",
          resourceType: "game_server",
          resourceId: row.id,
          resourceName: row.name,
          metadata: { volume: input.volume, path: path.posix.join(input.path, input.name) },
        });
        return { success: true };
      }),

    delete: operatorProcedure.input(fileTarget).mutation(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "operate");
      await guarded(() => deletePath(row, input.volume, input.path));
      await logAction(ctx, {
        action: "game_server.file_delete",
        resourceType: "game_server",
        resourceId: row.id,
        resourceName: row.name,
        metadata: { volume: input.volume, path: input.path },
      });
      return { success: true };
    }),

    rename: operatorProcedure
      .input(fileTarget.extend({ to: z.string().min(1).max(1024) }))
      .mutation(async ({ ctx, input }) => {
        const { row } = await resolveServer(ctx, input.id, "operate");
        await guarded(() => renamePath(row, input.volume, input.path, input.to));
        await logAction(ctx, {
          action: "game_server.file_rename",
          resourceType: "game_server",
          resourceId: row.id,
          resourceName: row.name,
          metadata: { volume: input.volume, from: input.path, to: input.to },
        });
        return { success: true };
      }),
  }),

  backups: router({
    list: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { row } = await resolveServer(ctx, input.id, "view");
        return ctx.db.query.gameServerBackups.findMany({
          where: eq(gameServerBackups.gameServerId, row.id),
          orderBy: [desc(gameServerBackups.startedAt)],
        });
      }),

    create: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { row } = await resolveServer(ctx, input.id, "operate");

        // The row exists before the job runs, so the list shows it queued.
        const [backup] = await ctx.db
          .insert(gameServerBackups)
          .values({
            gameServerId: row.id,
            filename: "",
            status: "queued",
            trigger: "manual",
            triggeredBy: ctx.user.id,
          })
          .returning();
        await gameBackupQueue.add("backup", {
          gameServerId: row.id,
          backupId: backup!.id,
          trigger: "manual",
          userId: ctx.user.id,
        });

        await logAction(ctx, {
          action: "game_server.backup",
          resourceType: "game_server",
          resourceId: row.id,
          resourceName: row.name,
        });
        return backup!;
      }),

    restore: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          backupId: z.string().uuid(),
          safetyBackup: z.boolean().default(true),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { row } = await resolveServer(ctx, input.id, "operate");
        const backup = await ctx.db.query.gameServerBackups.findFirst({
          where: and(
            eq(gameServerBackups.id, input.backupId),
            eq(gameServerBackups.gameServerId, row.id),
          ),
        });
        if (!backup || backup.status !== "success") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Backup not found" });
        }
        if (row.status === "restoring") {
          throw new TRPCError({ code: "CONFLICT", message: "A restore is already running" });
        }

        // One queue, concurrency 1: the safety backup finishes before the
        // restore starts.
        if (input.safetyBackup) {
          const [safety] = await ctx.db
            .insert(gameServerBackups)
            .values({
              gameServerId: row.id,
              filename: "",
              status: "queued",
              trigger: "pre-restore",
              triggeredBy: ctx.user.id,
            })
            .returning();
          await gameBackupQueue.add("backup", {
            gameServerId: row.id,
            backupId: safety!.id,
            trigger: "pre-restore",
            userId: ctx.user.id,
          });
        }
        await gameBackupQueue.add("restore", {
          gameServerId: row.id,
          backupId: backup.id,
        });

        await logAction(ctx, {
          action: "game_server.restore",
          resourceType: "game_server",
          resourceId: row.id,
          resourceName: row.name,
          metadata: { backupId: backup.id, safetyBackup: input.safetyBackup },
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid(), backupId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { row } = await resolveServer(ctx, input.id, "operate");
        const backup = await ctx.db.query.gameServerBackups.findFirst({
          where: and(
            eq(gameServerBackups.id, input.backupId),
            eq(gameServerBackups.gameServerId, row.id),
          ),
        });
        if (!backup) throw new TRPCError({ code: "NOT_FOUND", message: "Backup not found" });
        if (backup.status === "running" || backup.status === "queued") {
          throw new TRPCError({ code: "CONFLICT", message: "This backup is still in progress" });
        }

        if (backup.filename) {
          await fs.promises
            .rm(path.join(gameBackupDir(row.id), backup.filename), { force: true })
            .catch(() => {});
        }
        await ctx.db.delete(gameServerBackups).where(eq(gameServerBackups.id, backup.id));

        await logAction(ctx, {
          action: "game_server.delete_backup",
          resourceType: "game_server",
          resourceId: row.id,
          resourceName: row.name,
          metadata: { backupId: backup.id },
        });
        return { success: true };
      }),

    updateConfig: protectedProcedure
      .input(gameBackupConfigSchema)
      .mutation(async ({ ctx, input }) => {
        const { row } = await resolveServer(ctx, input.id, "operate");

        const backupCron = input.backupCron?.trim() || null;
        if (input.backupEnabled && !backupCron) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A schedule is required" });
        }
        if (backupCron) {
          try {
            assertValidCron(backupCron, "UTC");
          } catch (err: any) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
        }

        const [updated] = await ctx.db
          .update(gameServers)
          .set({
            backupEnabled: input.backupEnabled,
            backupCron,
            backupRetention: input.backupRetention,
            updatedAt: new Date(),
          })
          .where(eq(gameServers.id, row.id))
          .returning();
        await upsertGameBackupSchedule(updated!);

        await logAction(ctx, {
          action: "game_server.update_backup_config",
          resourceType: "game_server",
          resourceId: row.id,
          resourceName: row.name,
          metadata: {
            backupEnabled: input.backupEnabled,
            backupCron,
            backupRetention: input.backupRetention,
          },
        });
        return { success: true };
      }),
  }),
});
