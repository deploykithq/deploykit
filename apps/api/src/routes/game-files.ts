import * as fs from "fs";
import * as path from "path";
import { and, eq } from "drizzle-orm";

import { db } from "../db/index";
import { gameServers, gameServerBackups } from "../db/schema/index";
import { createContext, type Context } from "../trpc";
import { logAction } from "../lib/audit/audit";
import {
  canOperate,
  canViewSecrets,
  getProjectRoleByGameServerId,
} from "../lib/permissions";
import {
  GameFilesError,
  downloadPath,
  uploadFile,
} from "../services/game-files";
import { gameBackupDir } from "../services/game-server";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Readable } from "stream";
import type { GameServerT } from "../db/schema/index";

/**
 * Streaming file transfer for game servers: uploads (mods, plugins, worlds)
 * and downloads (files, folders, world backups).
 *
 * These cannot go through tRPC, whose bodies are capped at 1 MiB and parsed
 * as JSON. They authenticate the same way — the access token as a Bearer
 * header — and apply the same two layers as the tRPC procedures:
 *
 * - upload: a plugin jar is code the server will run, so it is gated like a
 *   console command — global operator AND project `canOperate`;
 * - download: config files and world archives hold RCON passwords and the
 *   like, so they need `canViewSecrets`.
 *
 * A non-member gets 404, never 403, so a server's existence is not revealed.
 */

const UPLOAD_MAX_BYTES = (() => {
  const configured = Number(process.env.GAME_UPLOAD_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 256 * 1024 * 1024;
})();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AccessT = "operate" | "secrets";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const authorize = async (
  req: FastifyRequest,
  id: string,
  access: AccessT,
): Promise<{ ctx: Context & { user: NonNullable<Context["user"]> }; row: GameServerT }> => {
  const ctx = await createContext(req);
  if (!ctx.user) throw new HttpError(401, "Unauthorized");
  if (!UUID_RE.test(id)) throw new HttpError(404, "Game server not found");

  const role = await getProjectRoleByGameServerId(ctx.user, id);
  const row = role
    ? await db.query.gameServers.findFirst({ where: eq(gameServers.id, id) })
    : null;
  if (!role || !row) throw new HttpError(404, "Game server not found");

  if (access === "operate") {
    const globalOperator = ctx.user.role === "admin" || ctx.user.role === "operator";
    if (!globalOperator || !canOperate(role)) {
      throw new HttpError(403, "Operator access required");
    }
  } else if (!canViewSecrets(role)) {
    throw new HttpError(403, "You cannot download files from this server");
  }

  return { ctx: ctx as any, row };
};

const fail = (reply: FastifyReply, err: any) => {
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
  if (err instanceof GameFilesError) {
    const status =
      err.code === "NOT_FOUND" ? 404 : err.code === "PAYLOAD_TOO_LARGE" ? 413 : 400;
    return reply.status(status).send({ error: err.message });
  }
  if (/size mismatch|premature/i.test(String(err?.message))) {
    return reply.status(400).send({ error: "The upload was incomplete" });
  }
  reply.log.error(err);
  return reply.status(500).send({ error: "File transfer failed" });
};

const attachment = (reply: FastifyReply, fileName: string, size?: number) => {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  reply.header(
    "Content-Disposition",
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  reply.header("Content-Type", "application/octet-stream");
  if (size !== undefined) reply.header("Content-Length", String(size));
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const registerGameFileRoutes = async (server: FastifyInstance): Promise<void> => {
  await server.register(async (app) => {
    // Hand the body over as a stream; it is piped straight into a tar entry.
    app.addContentTypeParser("application/octet-stream", (_req, payload, done) =>
      done(null, payload),
    );

    app.post<{ Params: { id: string }; Querystring: Record<string, string> }>(
      "/api/game-servers/:id/files/upload",
      { bodyLimit: UPLOAD_MAX_BYTES },
      async (req, reply) => {
        try {
          const { ctx, row } = await authorize(req, req.params.id, "operate");
          const volume = str(req.query.volume);
          const dir = str(req.query.path);
          const name = str(req.query.name);

          const size = Number(req.headers["content-length"]);
          if (!Number.isInteger(size) || size < 0) {
            throw new HttpError(411, "Content-Length is required");
          }
          if (size > UPLOAD_MAX_BYTES) {
            throw new HttpError(413, `Uploads are limited to ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)} MB`);
          }
          if (!req.headers["content-type"]?.startsWith("application/octet-stream")) {
            throw new HttpError(415, "Content-Type must be application/octet-stream");
          }

          await uploadFile(row, volume, dir, name, size, req.body as Readable);

          await logAction(ctx, {
            action: "game_server.file_upload",
            resourceType: "game_server",
            resourceId: row.id,
            resourceName: row.name,
            metadata: { volume, path: path.posix.join(dir, name), size },
          });
          return reply.send({ success: true });
        } catch (err) {
          return fail(reply, err);
        }
      },
    );

    app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
      "/api/game-servers/:id/files/download",
      async (req, reply) => {
        try {
          const { row } = await authorize(req, req.params.id, "secrets");
          const download = await downloadPath(row, str(req.query.volume), str(req.query.path));
          attachment(reply, download.fileName, download.size);
          return reply.send(download.stream);
        } catch (err) {
          return fail(reply, err);
        }
      },
    );

    app.get<{ Params: { id: string; backupId: string } }>(
      "/api/game-servers/:id/backups/:backupId/download",
      async (req, reply) => {
        try {
          const { row } = await authorize(req, req.params.id, "secrets");
          if (!UUID_RE.test(req.params.backupId)) throw new HttpError(404, "Backup not found");

          const backup = await db.query.gameServerBackups.findFirst({
            where: and(
              eq(gameServerBackups.id, req.params.backupId),
              eq(gameServerBackups.gameServerId, row.id),
              eq(gameServerBackups.status, "success"),
            ),
          });
          if (!backup) throw new HttpError(404, "Backup not found");

          const file = path.join(gameBackupDir(row.id), backup.filename);
          const stat = await fs.promises.stat(file).catch(() => null);
          if (!stat) throw new HttpError(404, "Backup file is missing");

          attachment(reply, `${row.name}-${backup.filename}`, stat.size);
          return reply.send(fs.createReadStream(file));
        } catch (err) {
          return fail(reply, err);
        }
      },
    );
  });
};

export { registerGameFileRoutes };
