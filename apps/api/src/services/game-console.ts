import { PassThrough } from "stream";

import { docker } from "../lib/docker";
import { GAME_NETWORK } from "../lib/game-isolation";
import { emitContainerLog } from "../lib/socket";
import { decryptEnvVars } from "../lib/encryption";

import { rconExec, RconError } from "./rcon";

import type { GameServerT } from "../db/schema/index";

/**
 * Sending commands to a game server's console.
 *
 * The console's *output* is the container's log stream, which the existing
 * log pipeline already delivers (the `logs:<containerId>` room). This module
 * only handles *input*, the way the game declares it:
 *
 * - `stdin`: written to the server process' stdin through `docker attach`.
 *   The container is created with OpenStdin and no TTY (a TTY would turn the
 *   log stream into raw output that every reader here demultiplexes).
 * - `rcon`: a short-lived RCON connection to the container's address on
 *   `deploykit-games`. The RCON port is never published; the reply is
 *   echoed into the log room so everyone watching the console sees it.
 * - `exec`: `docker exec` of the image's own injector (tModLoader's
 *   `inject`), with the command as one argv element; output echoed likewise.
 */

class GameConsoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameConsoleError";
  }
}

/**
 * Hijacked stdin streams, one per container. Attaching is cheap but not free,
 * and a console is typed into in bursts; the API runs as a single process, so
 * a module-level map is enough.
 */
const stdinStreams = new Map<string, NodeJS.ReadWriteStream>();

const getStdin = async (containerId: string): Promise<NodeJS.ReadWriteStream> => {
  const cached = stdinStreams.get(containerId);
  if (cached && (cached as any).writable !== false) return cached;

  const query = { stream: true, stdin: true, stdout: false, stderr: false };
  const stream = (await docker.getContainer(containerId).attach({
    ...query,
    hijack: true,
    // docker-modem sends a POST's options as its JSON body, and on a hijacked
    // connection the body *is* stdin: the server would read the options as a
    // console command. An empty `_body` sends none, and `_query` carries the
    // real parameters. The top-level `stdin` must stay false: docker-modem
    // only ends — and so only sends — the request when it is, and the upgrade
    // never happens otherwise. The upgraded socket is writable either way.
    _query: query,
    _body: {},
    stdin: false,
  } as any)) as NodeJS.ReadWriteStream;

  const evict = () => {
    if (stdinStreams.get(containerId) === stream) stdinStreams.delete(containerId);
  };
  stream.on("end", evict);
  stream.on("close", evict);
  stream.on("error", evict);
  // Nothing is read (stdout/stderr are off), but a paused stream would never
  // emit `end`; resume so eviction works.
  (stream as any).resume?.();

  stdinStreams.set(containerId, stream);
  return stream;
};

/** Forget an attached stream, e.g. after the container is recreated. */
const forgetConsole = (containerId: string | null | undefined): void => {
  if (!containerId) return;
  const stream = stdinStreams.get(containerId);
  stdinStreams.delete(containerId);
  try {
    (stream as any)?.end?.();
  } catch {
    // Already closed
  }
};

/** The container's IP on the game network, where RCON listens unpublished. */
const containerAddress = async (containerId: string): Promise<string> => {
  const info = await docker.getContainer(containerId).inspect();
  const networks = info.NetworkSettings?.Networks ?? {};
  const address =
    networks[GAME_NETWORK]?.IPAddress ||
    Object.values(networks).find((n: any) => n?.IPAddress)?.IPAddress;
  if (!address) {
    throw new GameConsoleError("The game server has no network address yet");
  }
  return address;
};

const isRunning = async (containerId: string): Promise<boolean> => {
  try {
    const info = await docker.getContainer(containerId).inspect();
    return Boolean(info.State?.Running);
  } catch {
    return false;
  }
};

const EXEC_TIMEOUT_SEC = 10;
/** Ours gives up a little after the in-container `timeout` has killed it. */
const EXEC_TIMEOUT_MS = (EXEC_TIMEOUT_SEC + 2) * 1000;

/**
 * Run an image's own command injector; argv only, never a shell. Docker has
 * no way to kill an exec, so the injector runs under the image's own
 * `timeout` (coreutils or BusyBox): giving up on our side alone would leave
 * a hung process in the server's container.
 */
const execCommand = async (containerId: string, argv: string[]): Promise<string> => {
  const exec = await docker.getContainer(containerId).exec({
    Cmd: ["timeout", "-s", "KILL", String(EXEC_TIMEOUT_SEC), ...argv],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  docker.modem.demuxStream(stream, out, out);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      (stream as any).destroy?.();
      reject(new GameConsoleError("The console command did not finish in time"));
    }, EXEC_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    stream.on("end", done);
    stream.on("close", done);
    stream.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new GameConsoleError(`Could not run the command: ${err.message}`));
    });
  });
  return Buffer.concat(chunks).toString("utf8").slice(0, 64 * 1024);
};

const consoleAvailable =(row: Pick<GameServerT, "spec">): boolean =>
  row.spec.console.method !== "none";

/**
 * Send one command to a running game server.
 *
 * @returns the RCON reply, or null for stdin (its effect shows up in the logs).
 * @throws GameConsoleError when the server has no console or is not running.
 */
const sendConsoleCommand = async (
  row: Pick<GameServerT, "spec" | "containerId" | "secretConfig">,
  command: string,
): Promise<string | null> => {
  const consoleSpec = row.spec.console;
  if (consoleSpec.method === "none") {
    throw new GameConsoleError("This game has no console");
  }
  if (/[\r\n\0]/.test(command)) {
    throw new GameConsoleError("A command cannot contain line breaks");
  }
  if (!row.containerId || !(await isRunning(row.containerId))) {
    throw new GameConsoleError("The game server is not running");
  }

  if (consoleSpec.method === "exec") {
    const reply = await execCommand(row.containerId, [...consoleSpec.command, command]);
    emitContainerLog(
      row.containerId,
      `> ${command}\n${reply ? `${reply.replace(/\n$/, "")}\n` : ""}`,
    );
    return reply;
  }

  if (consoleSpec.method === "stdin") {
    const stdin = await getStdin(row.containerId);
    await new Promise<void>((resolve, reject) =>
      stdin.write(`${command}\n`, (err) => (err ? reject(err) : resolve())),
    ).catch((err) => {
      forgetConsole(row.containerId);
      throw new GameConsoleError(`Could not write to the console: ${err.message}`);
    });
    return null;
  }

  const secrets = row.secretConfig ? decryptEnvVars(row.secretConfig) : {};
  const password = secrets[consoleSpec.passwordVar];
  if (!password) {
    throw new GameConsoleError("This server has no RCON password set");
  }

  try {
    const reply = await rconExec({
      host: await containerAddress(row.containerId),
      port: consoleSpec.port,
      password,
      protocol: consoleSpec.protocol,
      command,
    });
    emitContainerLog(
      row.containerId,
      `> ${command}\n${reply ? `${reply.replace(/\n$/, "")}\n` : ""}`,
    );
    return reply;
  } catch (err) {
    if (err instanceof RconError) {
      throw new GameConsoleError(
        err.code === "AUTH"
          ? "RCON rejected the stored password"
          : `${err.message}. The server may still be starting.`,
      );
    }
    throw err;
  }
};

export {
  sendConsoleCommand,
  forgetConsole,
  consoleAvailable,
  isRunning,
  GameConsoleError,
};
