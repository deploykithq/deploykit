import { Worker, type Job } from "bullmq";
import { and, desc, eq, lt } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { PassThrough } from "stream";

import { db } from "../db/index";
import { gameServers, gameServerBackups } from "../db/schema/index";
import { docker } from "../lib/docker";
import { redis } from "../lib/redis";
import { fireNotification } from "../services/notifier";
import { ensureHelper, execIn, helperName, MOUNT_ROOT } from "../services/game-files";
import { isRunning, sendConsoleCommand } from "../services/game-console";
import { loadModEnv } from "../services/game-mods";
import { mayApplyMods, snapshotModEnv } from "../services/game-mods-env";
import {
  GAME_BACKUP_ROOT,
  gameBackupDir,
  recreateGameServer,
  setGameServerStatus,
  startGameServer,
  stopContainerGracefully,
} from "../services/game-server";

import type Docker from "dockerode";
import type { GameServerT } from "../db/schema/index";

/**
 * World backups and restores for game servers.
 *
 * A backup is a gzipped tar of the paths each volume declares
 * (`volumes[].backup.include`), taken through a read-only helper container,
 * so it works whether the server is running or not. When it is running and
 * the game has a console, `backup.preCommands` (e.g. Minecraft's `save-off` /
 * `save-all flush`) run first so the world on disk is consistent, and
 * `postCommands` always run afterwards.
 *
 * A restore stops the server gracefully, empties the backed-up paths, unpacks
 * the archive in their place, and starts the server again if it was running.
 *
 * Both go through one queue with concurrency 1, so they never overlap — which
 * is also what makes "safety backup, then restore" run in that order.
 * Applying mods (`apply-mods`: recreate the container with the current mod
 * list) goes through the same queue for the same reason.
 */

interface BackupJobI {
  gameServerId: string;
  backupId?: string;
  trigger: "manual" | "schedule" | "pre-restore" | "pre-mods";
  userId?: string;
}

interface RestoreJobI {
  gameServerId: string;
  backupId: string;
}

interface ApplyModsJobI {
  gameServerId: string;
  /** The safety backup queued ahead of this job, if one was. */
  backupId?: string;
}

/** Failed backups are kept this long so the user can see why, then pruned. */
const FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const backupVolumes = (row: GameServerT) =>
  row.spec.volumes.filter((v) => v.backup !== false);

/** Paths to archive, relative to MOUNT_ROOT ("data", "config/worlds_local"). */
const includePaths = (row: GameServerT): string[] =>
  backupVolumes(row).flatMap((v) =>
    (v.backup as { include: string[] }).include.map((p) =>
      p === "." ? v.name : path.posix.join(v.name, p),
    ),
  );

const helperFor = (row: GameServerT, purpose: "backup", readOnly: boolean) =>
  ensureHelper(row, {
    name: helperName(row, readOnly ? "backup" : "restore"),
    purpose,
    readOnly,
    volumes: backupVolumes(row).map((v) => v.name),
  });

const removeContainer = async (container: Docker.Container) => {
  await container.remove({ force: true }).catch(() => {});
};

/** Run argv in a container, writing its stdout to a file. */
const execToFile = async (
  container: Docker.Container,
  cmd: string[],
  file: string,
): Promise<{ exitCode: number; stderr: string }> => {
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: true, stdin: false });
  const out = fs.createWriteStream(file, { mode: 0o600 });
  const err = new PassThrough();
  const errChunks: Buffer[] = [];
  err.on("data", (c: Buffer) => errChunks.push(c));
  docker.modem.demuxStream(stream, out, err);

  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    stream.on("error", reject);
  });
  await new Promise<void>((resolve) => out.end(resolve));

  const info = await exec.inspect();
  return {
    exitCode: info.ExitCode ?? -1,
    stderr: Buffer.concat(errChunks).toString("utf8").slice(0, 2000),
  };
};

const runConsoleCommands = async (row: GameServerT, commands: string[]) => {
  for (const command of commands) {
    try {
      await sendConsoleCommand(row, command);
    } catch (err: any) {
      console.warn(`[game-backup] "${command}" on ${row.name} failed: ${err?.message ?? err}`);
    }
  }
};

/** Keep the newest `retention` successful archives; prune old failures. */
const applyRetention = async (row: GameServerT) => {
  const successful = await db.query.gameServerBackups.findMany({
    where: and(
      eq(gameServerBackups.gameServerId, row.id),
      eq(gameServerBackups.status, "success"),
    ),
    orderBy: [desc(gameServerBackups.startedAt)],
  });
  for (const old of successful.slice(row.backupRetention)) {
    await fs.promises.rm(path.join(gameBackupDir(row.id), old.filename), { force: true });
    await db.delete(gameServerBackups).where(eq(gameServerBackups.id, old.id));
  }

  await db
    .delete(gameServerBackups)
    .where(
      and(
        eq(gameServerBackups.gameServerId, row.id),
        eq(gameServerBackups.status, "failed"),
        lt(gameServerBackups.startedAt, new Date(Date.now() - FAILED_RETENTION_MS)),
      ),
    );
};

const runBackup = async (data: BackupJobI): Promise<void> => {
  const row = await db.query.gameServers.findFirst({
    where: eq(gameServers.id, data.gameServerId),
  });
  if (!row) return; // Deleted since the job was queued

  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
  let backupId = data.backupId;
  if (backupId) {
    await db
      .update(gameServerBackups)
      .set({ filename, status: "running", startedAt: new Date() })
      .where(eq(gameServerBackups.id, backupId));
  } else {
    const [created] = await db
      .insert(gameServerBackups)
      .values({
        gameServerId: row.id,
        filename,
        status: "running",
        trigger: data.trigger,
        triggeredBy: data.userId ?? null,
      })
      .returning({ id: gameServerBackups.id });
    backupId = created!.id;
  }

  const dir = gameBackupDir(row.id);
  const file = path.join(dir, filename);
  const running =
    Boolean(row.containerId) && (await isRunning(row.containerId!)) &&
    row.spec.console.method !== "none";
  let helper: Docker.Container | null = null;

  try {
    if (backupVolumes(row).length === 0) {
      throw new Error("This game declares nothing to back up");
    }
    await fs.promises.mkdir(dir, { recursive: true });

    if (running && row.spec.backup.preCommands.length > 0) {
      await runConsoleCommands(row, row.spec.backup.preCommands);
      await new Promise((r) => setTimeout(r, row.spec.backup.settleSeconds * 1000));
    }

    helper = await helperFor(row, "backup", true);

    // A path the game has not created yet (no world saved) is skipped, not
    // an error; an archive with nothing in it is.
    const present: string[] = [];
    for (const include of includePaths(row)) {
      const probe = await execIn(helper, ["test", "-e", path.posix.join(MOUNT_ROOT, include)]);
      if (probe.exitCode === 0) present.push(include);
    }
    if (present.length === 0) {
      throw new Error("Nothing to back up yet: the server has not written its world");
    }

    const result = await execToFile(
      helper,
      ["tar", "-czf", "-", "-C", MOUNT_ROOT, "--", ...present],
      file,
    );
    if (result.exitCode !== 0) {
      throw new Error(`tar failed (${result.exitCode}): ${result.stderr.trim()}`);
    }

    const { size } = await fs.promises.stat(file);
    await db
      .update(gameServerBackups)
      .set({ status: "success", sizeBytes: size, finishedAt: new Date() })
      .where(eq(gameServerBackups.id, backupId));

    await applyRetention(row);

    fireNotification({
      event: "backup.completed",
      projectId: row.projectId,
      title: `Backup completed: ${row.name}`,
      message: `World backup of game server "${row.name}" completed (${Math.round(size / 1024 / 1024)} MB).`,
      meta: { gameServerId: row.id, gameServerName: row.name },
    }).catch(() => {});
  } catch (err: any) {
    const message = String(err?.message ?? err);
    await fs.promises.rm(file, { force: true }).catch(() => {});
    await db
      .update(gameServerBackups)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(gameServerBackups.id, backupId));

    fireNotification({
      event: "backup.failed",
      projectId: row.projectId,
      title: `Backup failed: ${row.name}`,
      message: `World backup of game server "${row.name}" failed: ${message}`,
      meta: { gameServerId: row.id, gameServerName: row.name, error: message },
    }).catch(() => {});
    throw err;
  } finally {
    if (helper) await removeContainer(helper);
    if (running && row.spec.backup.postCommands.length > 0) {
      await runConsoleCommands(row, row.spec.backup.postCommands);
    }
  }
};

const runRestore = async (data: RestoreJobI): Promise<void> => {
  const row = await db.query.gameServers.findFirst({
    where: eq(gameServers.id, data.gameServerId),
  });
  if (!row) return;

  const backup = await db.query.gameServerBackups.findFirst({
    where: and(
      eq(gameServerBackups.id, data.backupId),
      eq(gameServerBackups.gameServerId, row.id),
    ),
  });

  let helper: Docker.Container | null = null;
  try {
    if (!backup || backup.status !== "success") throw new Error("Backup not found");
    const file = path.join(gameBackupDir(row.id), backup.filename);
    await fs.promises.access(file);

    const wasRunning = Boolean(row.containerId) && (await isRunning(row.containerId!));
    await setGameServerStatus(row.id, "restoring");
    await stopContainerGracefully(row);

    helper = await helperFor(row, "backup", false);

    // Empty exactly what a backup takes, so files the archive does not hold
    // (a newer region file, a deleted plugin) do not survive the restore.
    for (const include of includePaths(row)) {
      const target = path.posix.join(MOUNT_ROOT, include);
      const isVolumeRoot = path.posix.dirname(target) === MOUNT_ROOT;
      const cmd = isVolumeRoot
        ? ["find", target, "-mindepth", "1", "-delete"]
        : ["rm", "-rf", "--", target];
      const result = await execIn(helper, cmd);
      if (result.exitCode !== 0) {
        throw new Error(`Could not clear ${include}: ${result.stderr.trim()}`);
      }
    }

    // Docker accepts a gzipped tar for putArchive and keeps owners and modes.
    await helper.putArchive(fs.createReadStream(file), { path: MOUNT_ROOT });
    await removeContainer(helper);
    helper = null;

    if (wasRunning) {
      await startGameServer({ ...row, status: "stopped" });
    } else {
      await setGameServerStatus(row.id, "stopped");
    }
  } catch (err: any) {
    await setGameServerStatus(row.id, "error", {
      statusMessage: `Restore failed: ${err?.message ?? err}`,
    });
    throw err;
  } finally {
    if (helper) await removeContainer(helper);
  }
};

/**
 * Recreate the container with the current mod list; the image installs it.
 * The list is rendered now, so whether the change is destructive is decided
 * now too — and a destructive one needs the safety backup queued ahead of
 * this job to have succeeded (see mayApplyMods).
 */
const runApplyMods = async (data: ApplyModsJobI): Promise<void> => {
  const row = await db.query.gameServers.findFirst({
    where: eq(gameServers.id, data.gameServerId),
  });
  if (!row) return;

  const backup = data.backupId
    ? await db.query.gameServerBackups.findFirst({
        where: and(
          eq(gameServerBackups.id, data.backupId),
          eq(gameServerBackups.gameServerId, row.id),
        ),
      })
    : null;
  const verdict = mayApplyMods(
    row.appliedModEnv,
    snapshotModEnv(await loadModEnv(row)),
    row.spec.mods,
    backup ? { status: backup.status, error: backup.error } : null,
  );
  if (!verdict.ok) {
    // Keep the server as it is; the reason shows next to its status.
    await setGameServerStatus(row.id, row.status, { statusMessage: verdict.reason });
    throw new Error(verdict.reason);
  }

  try {
    await recreateGameServer(row, row, "current");
  } catch (err: any) {
    await setGameServerStatus(row.id, "error", {
      statusMessage: `Applying mods failed: ${err?.message ?? err}`,
    });
    throw err;
  }
};

const startGameBackupWorker = () => {
  fs.mkdirSync(GAME_BACKUP_ROOT, { recursive: true });

  const worker = new Worker(
    "game-backup",
    async (job: Job) => {
      if (job.name === "restore") return runRestore(job.data as RestoreJobI);
      if (job.name === "apply-mods") return runApplyMods(job.data as ApplyModsJobI);
      return runBackup(job.data as BackupJobI);
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[game-backup] ${job?.name} ${job?.id} failed: ${err.message}`);
  });

  return worker;
};

export { startGameBackupWorker, includePaths };
