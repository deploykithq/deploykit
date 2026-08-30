import { sshExec, type SSHConnectionOpts } from "./ssh";
import { injectToken, sanitizeGitRef } from "./git";
import { shellEscape } from "../lib/shell";
import { buildTraefikLabels } from "../lib/traefik";

/**
 * Executes Docker commands on a remote server via SSH.
 * Mirrors the local DockerService interface.
 */
export class RemoteDockerService {
  private opts: SSHConnectionOpts;
  private s: string; // sudo prefix

  constructor(opts: SSHConnectionOpts) {
    this.opts = opts;
    this.s = opts.username !== "root" ? "sudo " : "";
  }

  /** Default 60s for general ops. Callers should pass explicit timeouts for
   *  long-running operations (clone: 120s, build: 600s, pull: 300s). */
  private async exec(cmd: string, timeout = 60_000) {
    return sshExec(this.opts, cmd, timeout);
  }

  private docker(cmd: string) {
    return `${this.s}docker ${cmd}`;
  }

  async pullImage(imageName: string): Promise<void> {
    const result = await this.exec(
      this.docker(`pull ${shellEscape(imageName)}`),
      300_000,
    );
    if (result.code !== 0) {
      throw new Error(
        `Failed to pull image: ${result.stderr || result.stdout}`,
      );
    }
  }

  async buildImage(
    contextPath: string,
    tag: string,
    dockerfilePath = "Dockerfile",
    onProgress?: (log: string) => void,
    buildArgs?: Record<string, string>,
  ): Promise<void> {
    // Build --build-arg flags with proper shell escaping
    const buildArgFlags = buildArgs
      ? Object.entries(buildArgs)
          .map(([k, v]) => `--build-arg ${shellEscape(`${k}=${v}`)}`)
          .join(" ")
      : "";

    // Same-commit redeploys rebuild a tag that already exists; Docker's
    // containerd image store can fail to overwrite it ("failed to create an
    // image ... AlreadyExists"). Untag first — best-effort, layers stay
    // cached and running containers keep the image ID.
    await this.exec(
      this.docker(`rmi -f ${shellEscape(tag)} 2>/dev/null || true`),
      30_000,
    );

    // Stream-like: we run the build and get all output at once.
    // Everything user-influenced is shell-escaped.
    const result = await this.exec(
      `cd ${shellEscape(contextPath)} && ${this.docker(
        `build -t ${shellEscape(tag)} -f ${shellEscape(dockerfilePath)} ${buildArgFlags} .`,
      )}`,
      600_000,
    );

    if (onProgress) {
      for (const line of result.stdout.split("\n")) {
        if (line.trim()) onProgress(line + "\n");
      }
      for (const line of result.stderr.split("\n")) {
        if (line.trim()) onProgress(line + "\n");
      }
    }

    if (result.code !== 0) {
      throw new Error(`Build failed: ${result.stderr || result.stdout}`);
    }
  }

  async createAndStart(opts: {
    name: string;
    image: string;
    env?: string[];
    ports?: Array<{ host: number; container: number }>;
    volumes?: string[];
    networkName?: string;
    labels?: Record<string, string>;
    command?: string[];
    restartPolicy?: string;
    // Accepted for interface parity; `docker run` only pulls when the image
    // is missing locally on the remote, so no explicit pull to skip here.
    skipPull?: boolean;
    cpuMillicores?: number;
    memoryMb?: number;
  }): Promise<string> {
    // Ensure network exists
    if (opts.networkName) {
      await this.exec(
        this.docker(
          `network create ${shellEscape(opts.networkName)} 2>/dev/null || true`,
        ),
      );
    }

    // Remove existing container
    await this.exec(
      this.docker(`rm -f ${shellEscape(opts.name)} 2>/dev/null || true`),
    );

    // Build docker run command — every value is shell-escaped
    const args: string[] = ["run", "-d", "--name", shellEscape(opts.name)];

    // Restart policy
    args.push(
      "--restart",
      shellEscape(opts.restartPolicy || "unless-stopped"),
    );

    // Resource limits
    if (opts.cpuMillicores) {
      args.push("--cpus", String(opts.cpuMillicores / 1000));
    }
    if (opts.memoryMb) {
      args.push("--memory", `${opts.memoryMb}m`);
      args.push("--memory-swap", `${opts.memoryMb}m`);
    }

    // Network
    if (opts.networkName) {
      args.push("--network", shellEscape(opts.networkName));
    }

    // Env vars (properly escaped to prevent injection)
    if (opts.env) {
      for (const e of opts.env) {
        args.push("-e", shellEscape(e));
      }
    }

    // Ports
    if (opts.ports) {
      for (const p of opts.ports) {
        args.push("-p", `${Number(p.host)}:${Number(p.container)}`);
      }
    }

    // Volumes
    if (opts.volumes) {
      for (const v of opts.volumes) {
        args.push("-v", shellEscape(v));
      }
    }

    // Labels
    if (opts.labels) {
      for (const [k, v] of Object.entries(opts.labels)) {
        args.push("--label", shellEscape(`${k}=${v}`));
      }
    }

    // Image
    args.push(shellEscape(opts.image));

    // Command
    if (opts.command) {
      args.push(...opts.command.map((c) => shellEscape(c)));
    }

    const result = await this.exec(this.docker(args.join(" ")), 120_000);

    if (result.code !== 0) {
      throw new Error(
        `Failed to start container: ${result.stderr || result.stdout}`,
      );
    }

    return result.stdout.trim().slice(0, 12); // container ID
  }

  /**
   * Real mounts on a container as reported by the remote daemon. Used after
   * start to verify that every configured volume was actually applied.
   */
  async getContainerMounts(containerId: string): Promise<
    Array<{
      source: string;
      destination: string;
      name?: string;
      rw: boolean;
    }>
  > {
    const result = await this.exec(
      this.docker(
        `inspect --format '{{json .Mounts}}' ${shellEscape(containerId)}`,
      ),
      30_000,
    );
    if (result.code !== 0) {
      throw new Error(
        `Failed to inspect container mounts: ${result.stderr || result.stdout}`,
      );
    }
    let mounts: any[];
    try {
      mounts = JSON.parse(result.stdout.trim() || "[]") ?? [];
    } catch {
      throw new Error("Could not parse container mounts from remote daemon");
    }
    return mounts.map((m: any) => ({
      source: m.Source || "",
      destination: m.Destination || "",
      name: m.Name,
      rw: m.RW !== false,
    }));
  }

  /**
   * Container paths the image declares via `VOLUME`. Each of these gets a
   * fresh anonymous volume on every container recreation unless a bind covers
   * it — callers attach deterministic named volumes instead.
   */
  async getImageVolumes(imageTag: string): Promise<string[]> {
    const result = await this.exec(
      this.docker(
        `image inspect --format '{{json .Config.Volumes}}' ${shellEscape(imageTag)}`,
      ),
      30_000,
    );
    if (result.code !== 0) {
      throw new Error(
        `Failed to inspect image volumes: ${result.stderr || result.stdout}`,
      );
    }
    try {
      return Object.keys(JSON.parse(result.stdout.trim() || "null") ?? {});
    } catch {
      throw new Error("Could not parse image volumes from remote daemon");
    }
  }

  async deployApp(opts: {
    name: string;
    image: string;
    env: string[];
    port: number;
    domains: Array<{ domain: string; https: boolean; port: number }>;
    labels?: Record<string, string>;
    volumes?: string[];
    skipPull?: boolean;
    replicas?: number;
    cpuMillicores?: number;
    memoryMb?: number;
  }): Promise<string> {
    const traefikLabels: Record<string, string> = {
      ...buildTraefikLabels(opts.name, opts.domains),
      "deploykit.managed": "true",
    };

    const labels = { ...traefikLabels, ...opts.labels };
    const replicas = Math.max(1, opts.replicas ?? 1);

    // Scale-down safety: drop every prior instance of this service first.
    const serviceId = opts.labels?.["deploykit.service"];
    if (serviceId) {
      await this.removeServiceContainers(serviceId);
    }

    // Identical Traefik labels across replicas → Traefik load-balances them.
    let primaryId = "";
    for (let i = 0; i < replicas; i++) {
      const id = await this.createAndStart({
        name: i === 0 ? opts.name : `${opts.name}-r${i}`,
        image: opts.image,
        env: opts.env,
        labels,
        networkName: "deploykit-network",
        volumes: opts.volumes,
        cpuMillicores: opts.cpuMillicores,
        memoryMb: opts.memoryMb,
      });
      if (i === 0) primaryId = id;
    }
    return primaryId;
  }

  /**
   * List container ids+names+state for a service via its `deploykit.service`
   * label. One line per container: "<id> <name> <state>".
   */
  async listServiceContainers(
    serviceId: string,
  ): Promise<Array<{ id: string; name: string; state: string }>> {
    const result = await this.exec(
      this.docker(
        `ps -a --filter ${shellEscape(`label=deploykit.service=${serviceId}`)} --format "{{.ID}} {{.Names}} {{.State}}"`,
      ),
      15_000,
    );
    if (result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [id, name, state] = l.split(/\s+/);
        return { id: id || "", name: name || "", state: state || "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async serviceContainerIds(serviceId: string): Promise<string[]> {
    const result = await this.exec(
      this.docker(
        `ps -aq --filter ${shellEscape(`label=deploykit.service=${serviceId}`)}`,
      ),
      15_000,
    );
    return result.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async startServiceContainers(serviceId: string): Promise<void> {
    const ids = await this.serviceContainerIds(serviceId);
    if (ids.length === 0) return;
    await this.exec(this.docker(`start ${ids.join(" ")}`), 30_000);
  }

  async stopServiceContainers(serviceId: string): Promise<void> {
    const ids = await this.serviceContainerIds(serviceId);
    if (ids.length === 0) return;
    await this.exec(this.docker(`stop -t 10 ${ids.join(" ")}`), 60_000);
  }

  async removeServiceContainers(serviceId: string): Promise<void> {
    const ids = await this.serviceContainerIds(serviceId);
    if (ids.length === 0) return;
    await this.exec(
      this.docker(`rm -f ${ids.join(" ")} 2>/dev/null || true`),
      60_000,
    );
  }

  /**
   * Live replica scaling without a rebuild is not yet supported on remote
   * (SSH) servers — cloning a container by inspect requires reconstructing the
   * `docker run` spec. The autoscaler detects remote servers and skips them, so
   * this should not be reached; it throws to make any accidental call loud.
   */
  async scaleService(_serviceId: string, _target: number): Promise<number> {
    throw new Error(
      "Live autoscaling is not supported on remote servers yet; redeploy to change replicas.",
    );
  }

  async start(containerId: string): Promise<void> {
    const result = await this.exec(
      this.docker(`start ${shellEscape(containerId)}`),
      30_000,
    );
    if (result.code !== 0) throw new Error(`Failed to start: ${result.stderr}`);
  }

  async stop(containerId: string): Promise<void> {
    const result = await this.exec(
      this.docker(`stop -t 10 ${shellEscape(containerId)}`),
      30_000,
    );
    if (result.code !== 0) throw new Error(`Failed to stop: ${result.stderr}`);
  }

  async stopAndRemove(containerId: string): Promise<void> {
    await this.exec(
      this.docker(`stop -t 10 ${shellEscape(containerId)} 2>/dev/null || true`),
      30_000,
    );
    await this.exec(
      this.docker(`rm -f ${shellEscape(containerId)} 2>/dev/null || true`),
      15_000,
    );
  }

  async restart(containerId: string): Promise<void> {
    const result = await this.exec(
      this.docker(`restart -t 10 ${shellEscape(containerId)}`),
      30_000,
    );
    if (result.code !== 0)
      throw new Error(`Failed to restart: ${result.stderr}`);
  }

  async getLogs(containerId: string, tail = 100): Promise<string> {
    const result = await this.exec(
      this.docker(
        `logs --tail ${Number(tail)} --timestamps ${shellEscape(containerId)} 2>&1`,
      ),
      15_000,
    );
    return result.stdout;
  }

  async getStats(containerId: string): Promise<{
    cpu: number;
    memory: { used: number; total: number; percent: number };
    network: { rx: number; tx: number };
  }> {
    const result = await this.exec(
      this.docker(
        `stats --no-stream --format "{{.CPUPerc}}|||{{.MemUsage}}|||{{.MemPerc}}|||{{.NetIO}}" ${shellEscape(containerId)}`,
      ),
      15_000,
    );

    if (result.code !== 0) {
      throw new Error(`Failed to get stats: ${result.stderr}`);
    }

    const parts = result.stdout.trim().split("|||");
    const cpuStr = (parts[0] || "0").replace("%", "").trim();
    const memStr = parts[1] || "0B / 0B";
    const memPercStr = (parts[2] || "0").replace("%", "").trim();
    const netStr = parts[3] || "0B / 0B";

    // Parse memory: "123.4MiB / 1.94GiB"
    const memParts = memStr.split("/").map((s) => s.trim());
    const memUsed = parseDockerSize(memParts[0] || "0B");
    const memTotal = parseDockerSize(memParts[1] || "0B");

    // Parse network: "1.23kB / 4.56kB"
    const netParts = netStr.split("/").map((s) => s.trim());
    const rx = parseDockerSize(netParts[0] || "0B");
    const tx = parseDockerSize(netParts[1] || "0B");

    return {
      cpu: parseFloat(cpuStr) || 0,
      memory: {
        used: memUsed,
        total: memTotal,
        percent: parseFloat(memPercStr) || 0,
      },
      network: { rx, tx },
    };
  }

  async gitClone(opts: {
    url: string;
    branch: string;
    destPath: string;
    token?: string;
    onLog?: (msg: string) => void;
  }): Promise<void> {
    // Ensure git is installed
    await this.exec(
      `${this.s}apt-get update -qq && ${this.s}apt-get install -y -qq git 2>/dev/null || ${this.s}yum install -y git 2>/dev/null || true`,
      120_000,
    );

    // Sanitize and clone (inject token for private repos)
    const cloneUrl = injectToken(opts.url, opts.token);
    const safeBranch = sanitizeGitRef(opts.branch);
    await this.exec(`rm -rf ${shellEscape(opts.destPath)}`);
    const result = await this.exec(
      `git clone --depth 1 --branch ${shellEscape(safeBranch)} ${shellEscape(cloneUrl)} ${shellEscape(opts.destPath)} 2>&1`,
      120_000,
    );

    if (result.code !== 0) {
      throw new Error(`Git clone failed: ${result.stderr || result.stdout}`);
    }

    if (opts.onLog) {
      opts.onLog(`Cloned ${opts.url} (branch: ${opts.branch})\n`);
    }
  }

  async gitGetCommitInfo(
    repoPath: string,
  ): Promise<{ hash: string; message: string }> {
    const hashResult = await this.exec(
      `cd ${shellEscape(repoPath)} && git rev-parse HEAD`,
    );
    const msgResult = await this.exec(
      `cd ${shellEscape(repoPath)} && git log -1 --format=%s`,
    );
    return {
      hash: hashResult.stdout.trim().slice(0, 12),
      message: msgResult.stdout.trim(),
    };
  }

  async cleanup(dirPath: string): Promise<void> {
    await this.exec(`rm -rf ${shellEscape(dirPath)}`);
  }

  /**
   * Write a .env file on the remote server (for frontend build-time env vars).
   */
  async writeEnvFile(
    dirPath: string,
    envVars: Record<string, string>,
  ): Promise<void> {
    const lines = Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    // Use printf with properly escaped content
    await this.exec(
      `printf '%s' ${shellEscape(lines)} > ${shellEscape(dirPath)}/.env`,
    );
  }
}

/** Parse docker size strings like "1.23GiB", "456MiB", "789kB" to bytes */
const parseDockerSize = (str: string): number => {
  const match = str.match(/([\d.]+)\s*(\w+)/);
  if (!match) return 0;
  const value = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1_000,
    kib: 1_024,
    mb: 1_000_000,
    mib: 1_048_576,
    gb: 1_000_000_000,
    gib: 1_073_741_824,
    tb: 1_000_000_000_000,
    tib: 1_099_511_627_776,
  };

  return Math.round(value * (multipliers[unit] || 1));
};
