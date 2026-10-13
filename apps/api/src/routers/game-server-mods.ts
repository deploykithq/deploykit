import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
  addGameModSchema,
  applyGameModsSchema,
  gameModSearchForGameSchema,
  gameModSearchSchema,
  gameModVersionsSchema,
  removeGameModSchema,
  setGameModpackSchema,
  updateGameModSchema,
} from "@deploykit/shared";

import { gameServerBackups } from "../db/schema/index";
import { router, protectedProcedure, operatorProcedure } from "../trpc";
import { logAction } from "../lib/audit/audit";
import { gameBackupQueue, isRateLimited } from "../lib/redis";
import { canOperate, canViewSecrets } from "../lib/permissions";
import { getGame } from "../services/game-catalog";
import { listFiles } from "../services/game-files";
import { allValues } from "../services/game-server";
import {
  addMod,
  checkUpdates,
  listMods,
  listVersions,
  loadModEnv,
  modsPending,
  removeMod,
  resolveFilter,
  resolveModpack,
  searchModpacks,
  searchMods,
  setModpack,
  sourcesFor,
  updateMod,
  GameModError,
} from "../services/game-mods";
import { compatFilter, isDestructiveChange, snapshotModEnv } from "../services/game-mods-env";

import { guarded, resolveServer } from "./game-server-access";

import type { Context } from "../trpc";
import type { GameServerT } from "../db/schema/index";

/**
 * Mods and modpacks. Reading the list and browsing catalogues is `canView`;
 * anything that changes what code the server runs is global operator AND
 * project `canOperate`, like a file upload or a console command.
 */

const SEARCH_LIMIT = 30;
const SEARCH_WINDOW_MS = 60_000;

/** Version lists back a picker: more generous than search. */
const VERSIONS_LIMIT = 60;
/** One check asks every catalogue about every mod on the server. */
const UPDATES_LIMIT = 6;

/** Every call that makes DeployKit query a catalogue is limited per user. */
const limitCatalogue = async (bucket: string, userId: string, limit: number) => {
  if (await isRateLimited(`${bucket}:${userId}`, limit, SEARCH_WINDOW_MS)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests, wait a minute" });
  }
};

const limitSearch = (userId: string) => limitCatalogue("mod-search", userId, SEARCH_LIMIT);

const requireMods = (row: Pick<GameServerT, "spec">) => {
  if (!row.spec.mods) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This game does not support mods" });
  }
};

const gameOrThrow = async (gameId: string) => {
  const game = await getGame(gameId);
  if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
  return game;
};

/** Files in the game's mod folders (uploaded by hand or installed by the image). */
const listOnDisk = async (row: GameServerT) => {
  const out: Array<{ directory: string; files: string[] }> = [];
  for (const dir of row.spec.mods?.directories ?? []) {
    const listing = await listFiles(row, dir.volume, dir.path).catch(() => null);
    out.push({
      directory: dir.path,
      files: (listing?.entries ?? []).filter((e) => e.type === "file").map((e) => e.name),
    });
  }
  return out;
};

type AuthedCtxT = Pick<Context, "db"> & { user: NonNullable<Context["user"]> };

/**
 * Queue the (optional) safety backup and the recreate, in that order. The
 * recreate is told which backup preceded it: it refuses a destructive
 * change unless that backup succeeded.
 */
const queueApply = async (ctx: AuthedCtxT, serverId: string, safetyBackup: boolean) => {
  let backupId: string | undefined;
  if (safetyBackup) {
    const [safety] = await ctx.db
      .insert(gameServerBackups)
      .values({
        gameServerId: serverId,
        filename: "",
        status: "queued",
        trigger: "pre-mods",
        triggeredBy: ctx.user.id,
      })
      .returning();
    backupId = safety!.id;
    await gameBackupQueue.add("backup", {
      gameServerId: serverId,
      backupId: safety!.id,
      trigger: "pre-mods",
      userId: ctx.user.id,
    });
  }
  await gameBackupQueue.add("apply-mods", { gameServerId: serverId, backupId });
};

export const gameServerModsRouter = router({
  sources: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "view");
      return sourcesFor(row.spec);
    }),

  /** For the create modal: no server yet, and the catalogue is public data. */
  sourcesForGame: protectedProcedure
    .input(z.object({ gameId: z.string().min(1).max(64) }))
    .query(async ({ input }) => sourcesFor(await gameOrThrow(input.gameId))),

  search: protectedProcedure.input(gameModSearchSchema).query(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "view");
    requireMods(row);
    await limitSearch(ctx.user.id);
    return guarded(() => searchMods(row, allValues(row), input));
  }),

  searchModpacks: protectedProcedure
    .input(gameModSearchForGameSchema)
    .query(async ({ ctx, input }) => {
      await limitSearch(ctx.user.id);
      const game = await gameOrThrow(input.gameId);
      return guarded(() => searchModpacks(game, input));
    }),

  versions: protectedProcedure.input(gameModVersionsSchema).query(async ({ ctx, input }) => {
    await limitCatalogue("mod-versions", ctx.user.id, VERSIONS_LIMIT);
    if (input.id) {
      const { row } = await resolveServer(ctx, input.id, "view");
      requireMods(row);
      return guarded(async () =>
        listVersions(
          row.spec,
          input.source,
          input.projectId,
          input.kind === "modpack" ? null : await resolveFilter(row, allValues(row), input.kind),
        ),
      );
    }
    if (!input.gameId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "id or gameId is required" });
    }
    const game = await gameOrThrow(input.gameId);
    return guarded(() => listVersions(game, input.source, input.projectId, null));
  }),

  list: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { row, role } = await resolveServer(ctx, input.id, "view");
      requireMods(row);
      // File names on disk are the file manager's data: canViewSecrets.
      const [mods, onDisk, pending] = await Promise.all([
        listMods(row),
        canViewSecrets(role) ? listOnDisk(row).catch(() => []) : [],
        modsPending(row),
      ]);
      let filter = null;
      let unsupported: string | null = null;
      try {
        filter = await resolveFilter(row, allValues(row));
      } catch (err) {
        if (err instanceof GameModError) unsupported = err.message;
        else throw err;
      }
      // itzg resolves LATEST again on every start, while mods stay pinned:
      // the next Minecraft release would break them.
      const followsLatest =
        mods.length > 0 && compatFilter(row.spec, allValues(row), row.modpack).versionAlias !== null;
      return {
        mods,
        modpack: row.modpack,
        followsLatest,
        onDisk,
        ...pending,
        filter,
        unsupported,
        canEdit: canOperate(role) && ctx.user.role !== "viewer",
      };
    }),

  checkUpdates: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { row } = await resolveServer(ctx, input.id, "view");
      requireMods(row);
      await limitCatalogue("mod-updates", ctx.user.id, UPDATES_LIMIT);
      return guarded(() => checkUpdates(row, allValues(row)));
    }),

  add: operatorProcedure.input(addGameModSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    const mod = await guarded(() => addMod(row, allValues(row), input, ctx.user.id));
    await logAction(ctx, {
      action: "game_server.mod_add",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: {
        source: mod.source,
        projectId: mod.projectId,
        name: mod.name,
        version: mod.versionLabel,
      },
    });
    return mod;
  }),

  update: operatorProcedure.input(updateGameModSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    const mod = await guarded(() => updateMod(row, allValues(row), input.modId, input));
    await logAction(ctx, {
      action: "game_server.mod_update",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { name: mod.name, enabled: mod.enabled, version: mod.versionLabel },
    });
    return mod;
  }),

  remove: operatorProcedure.input(removeGameModSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    const mod = await guarded(() => removeMod(row, input.modId));
    await logAction(ctx, {
      action: "game_server.mod_remove",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { name: mod.name, source: mod.source },
    });
    return { ok: true };
  }),

  setModpack: operatorProcedure.input(setGameModpackSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    const pack = input.modpack
      ? await guarded(() => resolveModpack(row.spec, input.modpack!))
      : null;
    await setModpack(row, pack);
    await logAction(ctx, {
      action: "game_server.modpack_set",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { modpack: pack ? `${pack.name} ${pack.versionLabel}` : null },
    });
    return pack;
  }),

  applyChanges: operatorProcedure.input(applyGameModsSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    if (row.status === "restoring" || row.status === "provisioning") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `The server is ${row.status}; try again when it is done`,
      });
    }
    // Never provisioned: its first start builds it with the current list.
    if (!row.containerId) {
      return { queued: false, safetyBackup: false, appliesOnStart: true };
    }
    const rendered = await loadModEnv(row);
    // Taking mods away can break a world: always back it up first then.
    const forced = isDestructiveChange(
      row.appliedModEnv,
      snapshotModEnv(rendered),
      row.spec.mods,
    );
    const safetyBackup = input.safetyBackup || forced;
    await queueApply(ctx, row.id, safetyBackup);
    await logAction(ctx, {
      action: "game_server.mods_apply",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { safetyBackup, forced },
    });
    return { queued: true, safetyBackup, appliesOnStart: false };
  }),
});
