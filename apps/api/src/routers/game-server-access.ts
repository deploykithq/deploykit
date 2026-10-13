import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { gameServers } from "../db/schema/index";
import {
  getProjectRoleByGameServerId,
  canView,
  canOperate,
  isAdmin,
  canViewSecrets,
} from "../lib/permissions";
import { GameConsoleError } from "../services/game-console";
import { GameFilesError } from "../services/game-files";
import { GameModError } from "../services/game-mods";
import { GameServerError } from "../services/game-server";

import type { UserRole } from "@deploykit/shared";
import type { Context } from "../trpc";
import type { GameServerT } from "../db/schema/index";

/**
 * Access to one game server, shared by the game server routers: resolve the
 * caller's project role before anything else, NOT_FOUND for non-members,
 * FORBIDDEN for members who lack the level.
 */

type LevelT = "view" | "operate" | "admin" | "secrets";

const ALLOWED: Record<LevelT, (role: UserRole) => boolean> = {
  view: canView,
  operate: canOperate,
  admin: isAdmin,
  secrets: canViewSecrets,
};

const MESSAGES: Record<LevelT, string> = {
  view: "Game server not found",
  operate: "Operator access required for this project",
  admin: "Admin access required for this project",
  secrets: "You cannot view this server's files or secrets",
};

/** Load a server the caller may act on at `level`, or throw. */
const resolveServer = async (
  ctx: Pick<Context, "db"> & { user: NonNullable<Context["user"]> },
  id: string,
  level: LevelT,
): Promise<{ row: GameServerT; role: UserRole }> => {
  const role = await getProjectRoleByGameServerId(ctx.user, id);
  const row = role
    ? await ctx.db.query.gameServers.findFirst({ where: eq(gameServers.id, id) })
    : null;
  if (!role || !row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Game server not found" });
  }
  if (!ALLOWED[level](role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: MESSAGES[level] });
  }
  return { row, role };
};

/** Turn a service error into the tRPC error it stands for. */
const rethrow = (err: unknown): never => {
  if (err instanceof GameServerError) {
    throw new TRPCError({ code: err.code, message: err.message });
  }
  if (err instanceof GameFilesError) {
    throw new TRPCError({
      code: err.code === "PAYLOAD_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : err.code,
      message: err.message,
    });
  }
  if (err instanceof GameModError) {
    throw new TRPCError({ code: err.code, message: err.message });
  }
  if (err instanceof GameConsoleError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
};

const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    return rethrow(err);
  }
};

export { resolveServer, rethrow, guarded, MESSAGES, type LevelT };
