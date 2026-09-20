import { spawn } from "child_process";
import { mkdir, rm, writeFile, chmod } from "fs/promises";
import path from "path";
import { platform, tmpdir } from "os";

import { shellEscape } from "../lib/shell";
import { sshExec, type SSHConnectionOpts } from "./ssh";

/**
 * Runs `docker compose` for a stack, locally or over SSH.
 *
 * ── The same-path rule ──────────────────────────────────────────────────────
 * The API runs in a container with the host's Docker socket mounted, so the
 * daemon that executes everything is the host's. A relative bind in a Compose
 * file (./nginx.conf:/etc/nginx/nginx.conf) is resolved by the Compose client
 * into an absolute path and sent to that daemon — which then looks for it on
 * the host, not inside the API container.
 *
 * So the stack directory must exist at the *same absolute path* on both sides.
 * `COMPOSE_ROOT` (default /var/lib/deploykit/compose) is bind-mounted into the
 * API container at its own path in docker-compose.prod.yml. Break that and
 * mounted config files silently arrive as empty directories.
 *
 * Remote servers have no such split — the Compose client and the daemon are the
 * same machine — so the remote runner just creates the directory over SSH.
 */

const DEFAULT_COMPOSE_ROOT = "/var/lib/deploykit/compose";

/**
 * Where stack directories live. On Windows there is no host/container split to
 * reconcile (Docker Desktop, dev only), so fall back to a temp directory rather
 * than a POSIX path that cannot exist there.
 */
const composeRoot = (): string =>
  process.env.COMPOSE_ROOT ||
  (platform() === "win32"
    ? path.join(tmpdir(), "deploykit-compose").replace(/\\/g, "/")
    : DEFAULT_COMPOSE_ROOT);

const stackDir = (stackId: string): string =>
  path.posix.join(composeRoot(), stackId);

/** Compose project name — prefixes every container, network and volume. */
const composeProjectName = (stackName: string): string => `dk-${stackName}`;

interface StackFilesI {
  stackId: string;
  composeFile: string;
  env: Record<string, string>;
  mounts: Array<{ filePath: string; content: string }>;
}

interface RunOptsI {
  stackId: string;
  stackName: string;
  onLog?: (line: string) => void;
}

interface UpOptsI extends RunOptsI {
  forceRecreate?: boolean;
  pull?: boolean;
}

interface DownOptsI extends RunOptsI {
  removeVolumes?: boolean;
}

interface ComposeRunnerI {
  /** Materialize docker-compose.yml, .env and any mounted config files. */
  writeStack(files: StackFilesI): Promise<void>;
  up(opts: UpOptsI): Promise<void>;
  stop(opts: RunOptsI): Promise<void>;
  start(opts: RunOptsI): Promise<void>;
  restart(opts: RunOptsI): Promise<void>;
  down(opts: DownOptsI): Promise<void>;
  /** Delete the stack directory once nothing references it any more. */
  removeStack(stackId: string): Promise<void>;
  /** Whether the `docker compose` plugin is available. */
  available(): Promise<boolean>;
}

/**
 * Serialize a `.env` for Compose.
 *
 * `$` is doubled because Compose interpolates env-file values: an unescaped `$`
 * in a generated password would be read as a variable reference and the
 * container would receive a truncated secret. Line breaks are rejected rather
 * than mangled — multi-line content belongs in a mount, not an env var.
 */
const serializeEnvFile = (env: Record<string, string>): string =>
  Object.entries(env)
    .map(([key, value]) => {
      if (/[\r\n]/.test(value)) {
        throw new Error(
          `Environment variable "${key}" contains a line break. Use a file mount for multi-line values.`,
        );
      }
      return `${key}=${value.replace(/\$/g, "$$$$")}`;
    })
    .join("\n");

/** Reject a mount path that would escape the stack directory. */
const assertContainedPath = (stackId: string, filePath: string): string => {
  const base = stackDir(stackId);
  const resolved = path.posix.normalize(path.posix.join(base, filePath));
  if (resolved !== base && !resolved.startsWith(`${base}/`)) {
    throw new Error(`Mount path escapes the stack directory: ${filePath}`);
  }
  return resolved;
};

// ---------------------------------------------------------------------------
// Local
// ---------------------------------------------------------------------------

/** Run a command, streaming both streams to `onLog`. Never uses a shell. */
const run = (
  command: string,
  args: string[],
  opts: { cwd?: string; onLog?: (line: string) => void; timeoutMs?: number },
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
    });

    let stderrTail = "";
    const forward = (chunk: Buffer) => opts.onLog?.(chunk.toString());

    child.stdout.on("data", forward);
    child.stderr.on("data", (chunk: Buffer) => {
      // Compose reports progress on stderr, so this is not necessarily an
      // error — keep the tail only to build a useful failure message.
      stderrTail = (stderrTail + chunk.toString()).slice(-8_000);
      forward(chunk);
    });

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`docker ${args.join(" ")} timed out`));
        }, opts.timeoutMs)
      : undefined;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve();
      reject(
        new Error(
          `docker ${args.join(" ")} exited ${code}` +
            (stderrTail.trim() ? `: ${stderrTail.trim()}` : ""),
        ),
      );
    });
  });

class LocalComposeRunner implements ComposeRunnerI {
  private composeArgs(opts: RunOptsI, extra: string[]): string[] {
    const dir = stackDir(opts.stackId);
    return [
      "compose",
      "--project-name",
      composeProjectName(opts.stackName),
      "--file",
      path.posix.join(dir, "docker-compose.yml"),
      "--env-file",
      path.posix.join(dir, ".env"),
      ...extra,
    ];
  }

  private exec(opts: RunOptsI, extra: string[], timeoutMs: number) {
    return run("docker", this.composeArgs(opts, extra), {
      cwd: stackDir(opts.stackId),
      onLog: opts.onLog,
      timeoutMs,
    });
  }

  async available(): Promise<boolean> {
    try {
      await run("docker", ["compose", "version"], { timeoutMs: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  async writeStack(files: StackFilesI): Promise<void> {
    const dir = stackDir(files.stackId);
    await mkdir(dir, { recursive: true });

    await writeFile(
      path.posix.join(dir, "docker-compose.yml"),
      files.composeFile,
      "utf8",
    );

    const envPath = path.posix.join(dir, ".env");
    await writeFile(envPath, serializeEnvFile(files.env), "utf8");
    // The .env holds every generated credential in the clear — it has to, for
    // Compose to read it — so at least keep it off other accounts on the host.
    await chmod(envPath, 0o600).catch(() => {});

    for (const mount of files.mounts) {
      const target = assertContainedPath(files.stackId, mount.filePath);
      await mkdir(path.posix.dirname(target), { recursive: true });
      await writeFile(target, mount.content, "utf8");
    }
  }

  up(opts: UpOptsI) {
    const extra = ["up", "-d", "--remove-orphans"];
    if (opts.forceRecreate) extra.push("--force-recreate");
    if (opts.pull) extra.push("--pull", "always");
    return this.exec(opts, extra, 20 * 60_000);
  }

  stop(opts: RunOptsI) {
    return this.exec(opts, ["stop"], 5 * 60_000);
  }

  start(opts: RunOptsI) {
    return this.exec(opts, ["start"], 5 * 60_000);
  }

  restart(opts: RunOptsI) {
    return this.exec(opts, ["restart"], 10 * 60_000);
  }

  down(opts: DownOptsI) {
    const extra = ["down", "--remove-orphans"];
    if (opts.removeVolumes) extra.push("--volumes");
    return this.exec(opts, extra, 10 * 60_000);
  }

  async removeStack(stackId: string): Promise<void> {
    await rm(stackDir(stackId), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Remote (SSH)
// ---------------------------------------------------------------------------

class RemoteComposeRunner implements ComposeRunnerI {
  private ssh: SSHConnectionOpts;
  private sudo: string;

  constructor(ssh: SSHConnectionOpts) {
    this.ssh = ssh;
    this.sudo = ssh.username !== "root" ? "sudo " : "";
  }

  private async exec(
    cmd: string,
    timeoutMs: number,
    onLog?: (line: string) => void,
  ): Promise<void> {
    const result = await sshExec(this.ssh, cmd, timeoutMs);
    if (onLog) {
      for (const line of `${result.stdout}\n${result.stderr}`.split("\n")) {
        if (line.trim()) onLog(`${line}\n`);
      }
    }
    if (result.code !== 0) {
      throw new Error(
        result.stderr?.trim() || result.stdout?.trim() || "Command failed",
      );
    }
  }

  /**
   * Write a file over SSH via base64.
   *
   * A heredoc would be shorter but breaks the moment the content contains the
   * delimiter, and Compose files and config blobs are exactly the kind of text
   * that eventually does.
   */
  private writeRemoteFile(remotePath: string, content: string): string {
    const b64 = Buffer.from(content, "utf8").toString("base64");
    return `printf %s ${shellEscape(b64)} | base64 -d > ${shellEscape(remotePath)}`;
  }

  private composeCmd(opts: RunOptsI, extra: string): string {
    const dir = stackDir(opts.stackId);
    return (
      `cd ${shellEscape(dir)} && ${this.sudo}docker compose ` +
      `--project-name ${shellEscape(composeProjectName(opts.stackName))} ` +
      `--file ${shellEscape(`${dir}/docker-compose.yml`)} ` +
      `--env-file ${shellEscape(`${dir}/.env`)} ${extra}`
    );
  }

  async available(): Promise<boolean> {
    try {
      await this.exec(`${this.sudo}docker compose version`, 20_000);
      return true;
    } catch {
      return false;
    }
  }

  async writeStack(files: StackFilesI): Promise<void> {
    const dir = stackDir(files.stackId);
    const cmds = [
      `${this.sudo}mkdir -p ${shellEscape(dir)}`,
      this.writeRemoteFile(`${dir}/docker-compose.yml`, files.composeFile),
      this.writeRemoteFile(`${dir}/.env`, serializeEnvFile(files.env)),
      `chmod 600 ${shellEscape(`${dir}/.env`)}`,
    ];

    for (const mount of files.mounts) {
      const target = assertContainedPath(files.stackId, mount.filePath);
      cmds.push(`mkdir -p ${shellEscape(path.posix.dirname(target))}`);
      cmds.push(this.writeRemoteFile(target, mount.content));
    }

    await this.exec(cmds.join(" && "), 120_000);
  }

  up(opts: UpOptsI) {
    let extra = "up -d --remove-orphans";
    if (opts.forceRecreate) extra += " --force-recreate";
    if (opts.pull) extra += " --pull always";
    return this.exec(this.composeCmd(opts, extra), 20 * 60_000, opts.onLog);
  }

  stop(opts: RunOptsI) {
    return this.exec(this.composeCmd(opts, "stop"), 5 * 60_000, opts.onLog);
  }

  start(opts: RunOptsI) {
    return this.exec(this.composeCmd(opts, "start"), 5 * 60_000, opts.onLog);
  }

  restart(opts: RunOptsI) {
    return this.exec(this.composeCmd(opts, "restart"), 10 * 60_000, opts.onLog);
  }

  down(opts: DownOptsI) {
    const extra = `down --remove-orphans${opts.removeVolumes ? " --volumes" : ""}`;
    return this.exec(this.composeCmd(opts, extra), 10 * 60_000, opts.onLog);
  }

  async removeStack(stackId: string): Promise<void> {
    await this.exec(
      `${this.sudo}rm -rf ${shellEscape(stackDir(stackId))}`,
      60_000,
    );
  }
}

const localComposeRunner = new LocalComposeRunner();

export {
  LocalComposeRunner,
  RemoteComposeRunner,
  localComposeRunner,
  composeRoot,
  stackDir,
  composeProjectName,
  serializeEnvFile,
  DEFAULT_COMPOSE_ROOT,
  type ComposeRunnerI,
  type StackFilesI,
  type RunOptsI,
  type UpOptsI,
  type DownOptsI,
};
