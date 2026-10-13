import * as path from "path";
import { PassThrough, type Readable } from "stream";
import tar from "tar-stream";

import { docker } from "../lib/docker";
import { GAME_HARDENING } from "../lib/game-isolation";

import type Docker from "dockerode";
import type { GameServerT } from "../db/schema/index";

import { gameContainerName, gameVolumeName } from "./game-server";

/**
 * The file manager behind a game server's Files tab.
 *
 * Volumes are never touched from the API container. Every operation runs in a
 * throwaway helper container (`dk-gs-<name>-files`) that mounts the server's
 * browsable volumes under `/mnt/<volume>`. That keeps working while the game
 * is stopped, needs no access to /var/lib/docker, and — the important part —
 * means a symlink planted in a world can only ever resolve inside the helper's
 * own empty filesystem, never into the API container that holds the Docker
 * socket and ENCRYPTION_KEY.
 *
 * Paths are always passed as argv elements, never through a shell.
 *
 * The helper keeps the same invariants as a task's one-off container: no
 * `deploykit.service` label (so nothing scrapes or scales it), no ports, no
 * network, and no restart policy. It exits by itself after `HELPER_TTL_SEC`.
 */

const HELPER_IMAGE = "alpine:3.20";
const HELPER_TTL_SEC = 900;
const MOUNT_ROOT = "/mnt";

const MAX_LIST_ENTRIES = 2_000;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_PATH_LENGTH = 1_024;

class GameFilesError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "PAYLOAD_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "GameFilesError";
  }
}

type SpecRowT = Pick<GameServerT, "id" | "name" | "spec">;

const browsableVolumes = (row: SpecRowT) =>
  row.spec.volumes.filter((v) => v.browsable);

/**
 * Map a (volume, relative path) pair to an absolute path inside the helper.
 *
 * Pure. Rejects anything that is not a plain path inside the volume: NUL
 * bytes, backslashes, `..` segments, and volumes the game does not mark as
 * browsable. "" or "." is the volume's root.
 */
const resolveSafePath = (row: Pick<GameServerT, "spec">, volume: string, rel: string): string => {
  const vol = row.spec.volumes.find((v) => v.name === volume && v.browsable);
  if (!vol) throw new GameFilesError("NOT_FOUND", "No such volume");

  if (typeof rel !== "string" || rel.length > MAX_PATH_LENGTH) {
    throw new GameFilesError("BAD_REQUEST", "Path too long");
  }
  if (/[\0\\]/.test(rel)) throw new GameFilesError("BAD_REQUEST", "Invalid path");
  if (rel.split("/").some((segment) => segment === "..")) {
    throw new GameFilesError("BAD_REQUEST", "Path cannot contain '..'");
  }

  const root = path.posix.join(MOUNT_ROOT, vol.name);
  const full = path.posix.join(root, path.posix.normalize(`/${rel}`));
  const trimmed = full.length > 1 ? full.replace(/\/+$/, "") : full;
  if (trimmed !== root && !trimmed.startsWith(`${root}/`)) {
    throw new GameFilesError("BAD_REQUEST", "Path escapes the volume");
  }
  return trimmed;
};

const isVolumeRoot = (absolute: string) =>
  path.posix.dirname(absolute) === MOUNT_ROOT;

/** A file name for an upload or a new folder: one segment, nothing special. */
const assertFileName = (name: string): void => {
  if (
    !name ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    /[\0/\\]/.test(name)
  ) {
    throw new GameFilesError("BAD_REQUEST", "Invalid file name");
  }
};

/**
 * `_` cannot appear in a game server's name, so a helper's name can never be
 * another game server's container name.
 */
const helperName = (row: SpecRowT, purpose: string) =>
  `${gameContainerName(row.name)}_${purpose}`;

const ensureImage = async (image: string): Promise<void> => {
  try {
    await docker.getImage(image).inspect();
  } catch {
    const stream = await docker.pull(image);
    await new Promise<void>((resolve, reject) =>
      docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve())),
    );
  }
};

/**
 * Create a helper container for a server's volumes, or reuse a running one.
 * `readOnly` helpers (backups) get their own name so they never share a
 * writable mount with the file manager.
 */
const ensureHelper = async (
  row: SpecRowT,
  opts: { name: string; purpose: "files" | "backup"; readOnly: boolean; volumes: string[] },
): Promise<Docker.Container> => {
  const existing = docker.getContainer(opts.name);
  let info: Docker.ContainerInspectInfo | null = null;
  try {
    info = await existing.inspect();
  } catch {
    // Not there yet
  }
  if (info) {
    const labels = info.Config?.Labels ?? {};
    const isOurs = labels["deploykit.owner"] === row.id;
    // A helper left behind by a deleted server of the same name is
    // disposable. Anything else that merely shares the name (application
    // names are free-form) is never exec'd into or removed.
    const isStaleHelper = labels["deploykit.managed"] === "true" && Boolean(labels["deploykit.helper"]);
    if (!isOurs && !isStaleHelper) {
      throw new GameFilesError(
        "BAD_REQUEST",
        `A container named "${opts.name}" belongs to another service`,
      );
    }
    if (isOurs && info.State?.Running) return existing;
    await existing.remove({ force: true }).catch(() => {});
  }

  await ensureImage(HELPER_IMAGE);

  try {
    const container = await docker.createContainer({
      name: opts.name,
      Image: HELPER_IMAGE,
      Cmd: ["sleep", String(HELPER_TTL_SEC)],
      Labels: {
        "deploykit.managed": "true",
        "deploykit.helper": opts.purpose,
        "deploykit.owner": row.id,
      },
      HostConfig: {
        Binds: opts.volumes.map(
          (v) =>
            `${gameVolumeName(row.name, v)}:${MOUNT_ROOT}/${v}${opts.readOnly ? ":ro" : ""}`,
        ),
        AutoRemove: true,
        NetworkMode: "none",
        RestartPolicy: { Name: "no" },
        SecurityOpt: GAME_HARDENING.securityOpt,
        CapDrop: GAME_HARDENING.capDrop,
        PidsLimit: GAME_HARDENING.pidsLimit,
      },
    });
    await container.start();
    return container;
  } catch (err: any) {
    // Two requests raced to create it: use the winner's.
    if (err?.statusCode === 409) return docker.getContainer(opts.name);
    throw err;
  }
};

const ensureFilesHelper = (row: SpecRowT) =>
  ensureHelper(row, {
    name: helperName(row, "files"),
    purpose: "files",
    readOnly: false,
    volumes: browsableVolumes(row).map((v) => v.name),
  });

interface ExecResultI {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Run argv in a container and collect its output. */
const execIn = async (
  container: Docker.Container,
  cmd: string[],
): Promise<ExecResultI> => {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  stdout.on("data", (c: Buffer) => out.push(c));
  stderr.on("data", (c: Buffer) => err.push(c));
  docker.modem.demuxStream(stream, stdout, stderr);
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    stream.on("error", reject);
  });
  const info = await exec.inspect();
  return {
    exitCode: info.ExitCode ?? -1,
    stdout: Buffer.concat(out).toString("utf8"),
    stderr: Buffer.concat(err).toString("utf8"),
  };
};

/** Run argv in the files helper, retrying once if the helper just expired. */
const execFiles = async (row: SpecRowT, cmd: string[]): Promise<ExecResultI> => {
  try {
    return await execIn(await ensureFilesHelper(row), cmd);
  } catch (err: any) {
    if (err?.statusCode !== 404 && err?.statusCode !== 409) throw err;
    return execIn(await ensureFilesHelper(row), cmd);
  }
};

interface FileEntryI {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string;
}

const TYPE_MAP: Record<string, FileEntryI["type"]> = {
  "regular file": "file",
  "regular empty file": "file",
  directory: "directory",
  "symbolic link": "symlink",
};

/**
 * Parse `stat -c '%F\t%s\t%Y\t%n'` lines. Pure.
 * A name may itself contain tabs, so only the first three are separators.
 */
const parseStatLines = (output: string): FileEntryI[] => {
  const entries: FileEntryI[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const [type, size, mtime, ...rest] = parts;
    entries.push({
      name: path.posix.basename(rest.join("\t")),
      type: TYPE_MAP[type!] ?? "other",
      size: Number(size) || 0,
      modifiedAt: new Date(Number(mtime) * 1000).toISOString(),
    });
  }
  return entries.sort((a, b) =>
    a.type === b.type
      ? a.name.localeCompare(b.name)
      : a.type === "directory"
        ? -1
        : b.type === "directory"
          ? 1
          : a.name.localeCompare(b.name),
  );
};

const listFiles = async (
  row: SpecRowT,
  volume: string,
  dir: string,
): Promise<{ entries: FileEntryI[]; truncated: boolean }> => {
  const absolute = resolveSafePath(row, volume, dir);
  const result = await execFiles(row, [
    "find",
    absolute,
    "-mindepth",
    "1",
    "-maxdepth",
    "1",
    "-exec",
    "stat",
    "-c",
    "%F\t%s\t%Y\t%n",
    "{}",
    "+",
  ]);
  if (result.exitCode !== 0) {
    throw new GameFilesError("NOT_FOUND", "No such directory");
  }
  const entries = parseStatLines(result.stdout);
  return {
    entries: entries.slice(0, MAX_LIST_ENTRIES),
    truncated: entries.length > MAX_LIST_ENTRIES,
  };
};

/** Owner, group, mode and kind of a path, or null when it does not exist. */
const statOwner = async (
  row: SpecRowT,
  absolute: string,
): Promise<{ uid: number; gid: number; mode: number; isDirectory: boolean } | null> => {
  const result = await execFiles(row, ["stat", "-c", "%u %g %a %F", absolute]);
  if (result.exitCode !== 0) return null;
  const [uid, gid, mode, ...kind] = result.stdout.trim().split(" ");
  return {
    uid: Number(uid),
    gid: Number(gid),
    mode: parseInt(mode ?? "644", 8),
    isDirectory: kind.join(" ") === "directory",
  };
};

/** First entry of a tar stream from getArchive, as a readable. */
const firstEntry = (
  archive: NodeJS.ReadableStream,
): Promise<{ header: tar.Headers; stream: Readable }> =>
  new Promise((resolve, reject) => {
    const extract = tar.extract();
    let found = false;
    extract.on("entry", (header, stream, next) => {
      if (found) {
        stream.resume();
        next();
        return;
      }
      found = true;
      resolve({ header, stream });
      stream.on("end", next);
    });
    extract.on("finish", () => {
      if (!found) reject(new GameFilesError("NOT_FOUND", "No such file"));
    });
    extract.on("error", reject);
    archive.pipe(extract);
  });

const getArchive = async (row: SpecRowT, absolute: string) => {
  const helper = await ensureFilesHelper(row);
  try {
    return await helper.getArchive({ path: absolute });
  } catch (err: any) {
    if (err?.statusCode === 404) throw new GameFilesError("NOT_FOUND", "No such file");
    throw err;
  }
};

/** A text file's content, for the editor. */
const readFile = async (
  row: SpecRowT,
  volume: string,
  filePath: string,
): Promise<{ content: string; size: number }> => {
  const absolute = resolveSafePath(row, volume, filePath);
  const { header, stream } = await firstEntry(await getArchive(row, absolute));

  if (header.type !== "file") {
    stream.resume();
    throw new GameFilesError("BAD_REQUEST", "Not a file");
  }
  if ((header.size ?? 0) > MAX_TEXT_BYTES) {
    stream.resume();
    throw new GameFilesError(
      "PAYLOAD_TOO_LARGE",
      "File is too large to edit here; download it instead",
    );
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const data = Buffer.concat(chunks);
  if (data.subarray(0, 8192).includes(0)) {
    throw new GameFilesError("BAD_REQUEST", "Binary file; download it instead");
  }
  return { content: data.toString("utf8"), size: data.length };
};

/** Pack one file and put it into `dir` inside the helper. */
const putFile = async (
  row: SpecRowT,
  dir: string,
  name: string,
  size: number,
  owner: { uid: number; gid: number; mode: number },
  source: Readable | Buffer,
): Promise<void> => {
  const pack = tar.pack();
  const entryDone = new Promise<void>((resolve, reject) => {
    const entry = pack.entry(
      { name, size, mode: owner.mode, uid: owner.uid, gid: owner.gid, mtime: new Date() },
      (err) => (err ? reject(err) : resolve()),
    );
    if (Buffer.isBuffer(source)) {
      entry.end(source);
    } else {
      source.on("error", (err) => entry.destroy(err));
      source.pipe(entry);
    }
  });

  const helper = await ensureFilesHelper(row);
  const put = helper.putArchive(pack, { path: dir });
  await entryDone.then(() => pack.finalize());
  await put;
};

const writeFile = async (
  row: SpecRowT,
  volume: string,
  filePath: string,
  content: string,
): Promise<{ size: number }> => {
  const absolute = resolveSafePath(row, volume, filePath);
  if (isVolumeRoot(absolute)) {
    throw new GameFilesError("BAD_REQUEST", "Invalid file path");
  }
  const data = Buffer.from(content, "utf8");
  if (data.length > MAX_TEXT_BYTES) {
    throw new GameFilesError("PAYLOAD_TOO_LARGE", "File is too large to edit here");
  }

  const dir = path.posix.dirname(absolute);
  const parent = await statOwner(row, dir);
  if (!parent) throw new GameFilesError("NOT_FOUND", "No such directory");
  // Keep an existing file's owner and mode; a new one takes the folder's owner.
  const current = await statOwner(row, absolute);
  const owner = current ?? { uid: parent.uid, gid: parent.gid, mode: 0o644 };

  await putFile(row, dir, path.posix.basename(absolute), data.length, owner, data);
  return { size: data.length };
};

/** Stream an upload (a mod, a plugin, a world) into a folder. */
const uploadFile = async (
  row: SpecRowT,
  volume: string,
  dir: string,
  fileName: string,
  size: number,
  source: Readable,
): Promise<void> => {
  assertFileName(fileName);
  const absoluteDir = resolveSafePath(row, volume, dir);
  const parent = await statOwner(row, absoluteDir);
  if (!parent) throw new GameFilesError("NOT_FOUND", "No such directory");

  // tar needs the size up front; a body that does not match it fails the
  // entry ("size mismatch") instead of writing a truncated file.
  await putFile(
    row,
    absoluteDir,
    fileName,
    size,
    { uid: parent.uid, gid: parent.gid, mode: 0o644 },
    source,
  );
};

const makeDirectory = async (
  row: SpecRowT,
  volume: string,
  dir: string,
  name: string,
): Promise<void> => {
  assertFileName(name);
  const parentPath = resolveSafePath(row, volume, dir);
  const parent = await statOwner(row, parentPath);
  if (!parent) throw new GameFilesError("NOT_FOUND", "No such directory");
  const target = path.posix.join(parentPath, name);
  const made = await execFiles(row, ["mkdir", "--", target]);
  if (made.exitCode !== 0) {
    throw new GameFilesError("BAD_REQUEST", made.stderr.trim() || "Could not create folder");
  }
  await execFiles(row, ["chown", `${parent.uid}:${parent.gid}`, "--", target]);
};

const deletePath = async (row: SpecRowT, volume: string, target: string): Promise<void> => {
  const absolute = resolveSafePath(row, volume, target);
  if (isVolumeRoot(absolute)) {
    throw new GameFilesError("BAD_REQUEST", "The volume root cannot be deleted");
  }
  const result = await execFiles(row, ["rm", "-rf", "--", absolute]);
  if (result.exitCode !== 0) {
    throw new GameFilesError("BAD_REQUEST", result.stderr.trim() || "Could not delete");
  }
};

const renamePath = async (
  row: SpecRowT,
  volume: string,
  from: string,
  to: string,
): Promise<void> => {
  const source = resolveSafePath(row, volume, from);
  const target = resolveSafePath(row, volume, to);
  if (isVolumeRoot(source) || isVolumeRoot(target)) {
    throw new GameFilesError("BAD_REQUEST", "The volume root cannot be moved");
  }
  if ((await statOwner(row, target)) !== null) {
    throw new GameFilesError("BAD_REQUEST", "Something with that name already exists");
  }
  const result = await execFiles(row, ["mv", "--", source, target]);
  if (result.exitCode !== 0) {
    throw new GameFilesError("BAD_REQUEST", result.stderr.trim() || "Could not rename");
  }
};

/**
 * A download: a file streams as itself, a folder as a tar archive.
 */
const downloadPath = async (
  row: SpecRowT,
  volume: string,
  target: string,
): Promise<{ stream: Readable; fileName: string; size?: number; isArchive: boolean }> => {
  const absolute = resolveSafePath(row, volume, target);
  const baseName = path.posix.basename(absolute) || volume;
  const found = await statOwner(row, absolute);
  if (!found) throw new GameFilesError("NOT_FOUND", "No such file");

  const archive = await getArchive(row, absolute);
  if (found.isDirectory) {
    return {
      stream: archive as unknown as Readable,
      fileName: `${baseName}.tar`,
      isArchive: true,
    };
  }

  const { header, stream } = await firstEntry(archive);
  return { stream, fileName: baseName, size: header.size, isArchive: false };
};

export {
  GameFilesError,
  helperName,
  resolveSafePath,
  parseStatLines,
  assertFileName,
  ensureHelper,
  execIn,
  listFiles,
  readFile,
  writeFile,
  uploadFile,
  makeDirectory,
  deletePath,
  renamePath,
  downloadPath,
  MOUNT_ROOT,
  HELPER_IMAGE,
  type FileEntryI,
};
