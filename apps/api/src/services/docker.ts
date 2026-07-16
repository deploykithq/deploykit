import { docker, ensureNetwork, connectToNetwork } from "../lib/docker";

interface CreateContainerOptsI {
  name: string;
  image: string;
  env?: string[];
  ports?: Array<{ host: number; container: number }>;
  volumes?: string[];
  networkName?: string;
  labels?: Record<string, string>;
  command?: string[];
  restartPolicy?: string;
  skipPull?: boolean; // Skip pull for locally built images
  cpuMillicores?: number; // CPU cap in millicores (1000 = 1 core)
  memoryMb?: number; // Memory cap in MB
}

export interface ServiceContainerI {
  id: string;
  name: string;
  state: string; // running | exited | created | ...
}

interface ContainerStatsI {
  cpu: number;
  memory: { used: number; total: number; percent: number };
  network: { rx: number; tx: number };
}

export class DockerService {
  /**
   * Pull image, create container, connect to network, start it.
   * Returns the container ID.
   */
  async createAndStart(opts: CreateContainerOptsI): Promise<string> {
    // Ensure network exists
    if (opts.networkName) {
      await ensureNetwork(opts.networkName);
    }

    // Pull image (skip for locally built images)
    if (!opts.skipPull) {
      const localExists = await this.imageExistsLocally(opts.image);
      if (!localExists) {
        await this.pullImage(opts.image);
      }
    }

    // Remove existing container with same name
    try {
      const existing = docker.getContainer(opts.name);
      await existing.stop().catch(() => {});
      await existing.remove({ force: true });
    } catch {
      // Doesn't exist
    }

    // Build port bindings
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const exposedPorts: Record<string, object> = {};

    if (opts.ports) {
      for (const p of opts.ports) {
        const key = `${p.container}/tcp`;
        exposedPorts[key] = {};
        portBindings[key] = [{ HostPort: String(p.host) }];
      }
    }

    // Build volume binds
    const binds = opts.volumes || [];

    // Create container
    const container = await docker.createContainer({
      Image: opts.image,
      name: opts.name,
      Env: opts.env || [],
      ExposedPorts: exposedPorts,
      Labels: opts.labels || {},
      Cmd: opts.command,
      HostConfig: {
        PortBindings: portBindings,
        Binds: binds,
        RestartPolicy: { Name: opts.restartPolicy || "unless-stopped" },
        ...(opts.cpuMillicores
          ? { NanoCpus: opts.cpuMillicores * 1_000_000 }
          : {}),
        ...(opts.memoryMb
          ? {
              Memory: opts.memoryMb * 1024 * 1024,
              // Match swap to the hard limit so the container can't escape
              // its memory cap via swap.
              MemorySwap: opts.memoryMb * 1024 * 1024,
            }
          : {}),
      },
    });

    // Connect to network before starting
    if (opts.networkName) {
      await connectToNetwork(container.id, opts.networkName);
    }

    // Start
    await container.start();
    return container.id;
  }

  /**
   * Real mounts on a container as reported by the daemon. Used after start to
   * verify that every configured volume was actually applied.
   */
  async getContainerMounts(containerId: string): Promise<
    Array<{
      source: string;
      destination: string;
      name?: string;
      rw: boolean;
    }>
  > {
    const info = await docker.getContainer(containerId).inspect();
    return ((info as any).Mounts || []).map((m: any) => ({
      source: m.Source || "",
      destination: m.Destination || "",
      name: m.Name,
      rw: m.RW !== false,
    }));
  }

  /**
   * Deploy an application container with Traefik labels for routing
   */
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
      "traefik.enable": "true",
      "deploykit.managed": "true",
    };

    // Generate Traefik labels for each domain
    for (let i = 0; i < opts.domains.length; i++) {
      const d = opts.domains[i]!;
      const routerName = `${opts.name}${i > 0 ? `-${i}` : ""}`;

      traefikLabels[`traefik.http.routers.${routerName}.rule`] =
        `Host(\`${d.domain}\`)`;
      traefikLabels[
        `traefik.http.services.${routerName}.loadbalancer.server.port`
      ] = String(d.port);

      if (d.https) {
        traefikLabels[`traefik.http.routers.${routerName}.entrypoints`] =
          "websecure";
        traefikLabels[`traefik.http.routers.${routerName}.tls.certresolver`] =
          "letsencrypt";
        // HTTP → HTTPS redirect
        traefikLabels[`traefik.http.routers.${routerName}-http.rule`] =
          `Host(\`${d.domain}\`)`;
        traefikLabels[`traefik.http.routers.${routerName}-http.entrypoints`] =
          "web";
        traefikLabels[`traefik.http.routers.${routerName}-http.middlewares`] =
          `${routerName}-redirect`;
        traefikLabels[
          `traefik.http.middlewares.${routerName}-redirect.redirectscheme.scheme`
        ] = "https";
      } else {
        traefikLabels[`traefik.http.routers.${routerName}.entrypoints`] = "web";
      }
    }

    const labels = { ...traefikLabels, ...opts.labels };
    const replicas = Math.max(1, opts.replicas ?? 1);

    // Remove every prior instance of this service before recreating, so a
    // scale-down (e.g. 3 → 1) doesn't leave orphan replicas running.
    const serviceId = opts.labels?.["deploykit.service"];
    if (serviceId) {
      await this.removeServiceContainers(serviceId);
    }

    // All replicas share identical Traefik labels (same service name), so
    // Traefik load-balances across them automatically. Only the container
    // name differs. The primary (i=0) keeps the canonical name.
    let primaryId = "";
    for (let i = 0; i < replicas; i++) {
      const id = await this.createAndStart({
        name: i === 0 ? opts.name : `${opts.name}-r${i}`,
        image: opts.image,
        env: opts.env,
        labels,
        networkName: "deploykit-network",
        volumes: opts.volumes,
        skipPull: opts.skipPull,
        cpuMillicores: opts.cpuMillicores,
        memoryMb: opts.memoryMb,
      });
      if (i === 0) primaryId = id;
    }
    return primaryId;
  }

  /**
   * List all containers belonging to a service (by the `deploykit.service`
   * label). Used to operate on every replica of an app at once.
   */
  async listServiceContainers(serviceId: string): Promise<ServiceContainerI[]> {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [`deploykit.service=${serviceId}`] },
    });
    return containers
      .map((c) => ({
        id: c.Id,
        name: (c.Names?.[0] || "").replace(/^\//, ""),
        state: c.State,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async startServiceContainers(serviceId: string): Promise<void> {
    const list = await this.listServiceContainers(serviceId);
    for (const c of list) {
      await docker.getContainer(c.id).start().catch(() => {});
    }
  }

  async stopServiceContainers(serviceId: string): Promise<void> {
    const list = await this.listServiceContainers(serviceId);
    for (const c of list) {
      await docker.getContainer(c.id).stop({ t: 10 }).catch(() => {});
    }
  }

  async removeServiceContainers(serviceId: string): Promise<void> {
    const list = await this.listServiceContainers(serviceId);
    for (const c of list) {
      const container = docker.getContainer(c.id);
      await container.stop({ t: 10 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    }
  }

  /**
   * Scale a service to `target` replicas WITHOUT rebuilding the image.
   *
   * Scale-up clones the primary container's runtime config (Image, Env, Labels,
   * resource limits) via `docker inspect`, so new replicas are identical to the
   * running one and share its Traefik labels (load-balanced automatically).
   * Scale-down removes the highest-index replicas. The primary (index 0) is
   * never touched. Returns the resulting replica count.
   */
  async scaleService(serviceId: string, target: number): Promise<number> {
    const list = await this.listServiceContainers(serviceId);
    if (list.length === 0) return 0; // nothing deployed — nothing to clone

    const replicaSuffix = /-r(\d+)$/;
    const primary = list.find((c) => !replicaSuffix.test(c.name)) ?? list[0]!;
    const current = list.length;
    const desired = Math.max(1, target);
    if (desired === current) return current;

    if (desired > current) {
      // Scale up — clone the primary into fresh replica names.
      const info = await docker.getContainer(primary.id).inspect();
      const existing = new Set(list.map((c) => c.name));
      let i = 1;
      while (existing.size < desired) {
        const name = `${primary.name}-r${i}`;
        if (!existing.has(name)) {
          await this.cloneContainer(info, name);
          existing.add(name);
        }
        i++;
      }
    } else {
      // Scale down — drop the highest-index replicas, keep the primary.
      const replicas = list
        .filter((c) => replicaSuffix.test(c.name))
        .sort(
          (a, b) =>
            Number(b.name.match(replicaSuffix)![1]) -
            Number(a.name.match(replicaSuffix)![1]),
        );
      let toRemove = current - desired;
      for (const c of replicas) {
        if (toRemove <= 0) break;
        const container = docker.getContainer(c.id);
        await container.stop({ t: 10 }).catch(() => {});
        await container.remove({ force: true }).catch(() => {});
        toRemove--;
      }
    }
    return desired;
  }

  /** Create + start a copy of an inspected container under a new name. */
  private async cloneContainer(info: any, name: string): Promise<void> {
    // Clear any stale container holding the target name.
    try {
      const existing = docker.getContainer(name);
      await existing.stop({ t: 5 }).catch(() => {});
      await existing.remove({ force: true });
    } catch {
      // Doesn't exist
    }

    const cfg = info.Config || {};
    const hostCfg = info.HostConfig || {};
    const networkName = "deploykit-network";
    await ensureNetwork(networkName);

    const container = await docker.createContainer({
      Image: cfg.Image,
      name,
      Env: cfg.Env || [],
      Labels: cfg.Labels || {},
      ExposedPorts: cfg.ExposedPorts || {},
      Cmd: cfg.Cmd || undefined,
      Entrypoint: cfg.Entrypoint || undefined,
      HostConfig: {
        // Drop host PortBindings: replicas reach the world through Traefik on
        // the shared network, so they must not contend for a host port.
        Binds: hostCfg.Binds || [],
        RestartPolicy: hostCfg.RestartPolicy || { Name: "unless-stopped" },
        ...(hostCfg.NanoCpus ? { NanoCpus: hostCfg.NanoCpus } : {}),
        ...(hostCfg.Memory
          ? { Memory: hostCfg.Memory, MemorySwap: hostCfg.MemorySwap }
          : {}),
      },
    });
    await connectToNetwork(container.id, networkName);
    await container.start();
  }

  //Container lifecycle
  async start(containerId: string): Promise<void> {
    const container = docker.getContainer(containerId);
    await container.start();
  }

  async stop(containerId: string): Promise<void> {
    const container = docker.getContainer(containerId);
    await container.stop({ t: 10 });
  }

  async stopAndRemove(containerId: string): Promise<void> {
    const container = docker.getContainer(containerId);
    await container.stop({ t: 10 }).catch(() => {});
    await container.remove({ force: true });
  }

  async restart(containerId: string): Promise<void> {
    const container = docker.getContainer(containerId);
    await container.restart({ t: 10 });
  }

  //Image operations
  async pullImage(imageName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      docker.pull(
        imageName,
        (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (err: Error | null) => {
            if (err) return reject(err);
            resolve();
          });
        },
      );
    });
  }

  async buildImage(
    contextPath: string,
    tag: string,
    dockerfilePath = "Dockerfile",
    onProgress?: (log: string) => void,
  ): Promise<void> {
    // Docker Engine API expects a context-relative path WITHOUT a leading `./`.
    // Users (and our DB default) often store `./Dockerfile`, which makes
    // dockerode reject the build with "Cannot locate specified Dockerfile".
    // Normalize it here so both forms work.
    const dockerfile = dockerfilePath.replace(/^\.\/+/, "");

    const stream = await docker.buildImage(
      { context: contextPath, src: ["."] },
      { t: tag, dockerfile },
    );

    return new Promise((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) return reject(err);
          resolve();
        },
        (event: any) => {
          if (event.stream && onProgress) {
            onProgress(event.stream);
          }
        },
      );
    });
  }

  async getLogs(containerId: string, tail = 100): Promise<string> {
    try {
      const container = docker.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: true,
        tail,
        follow: false,
      });

      // Docker can return string or Buffer depending on platform/config
      if (typeof logs === "string") return logs;
      if (Buffer.isBuffer(logs)) return this.demuxStream(logs);
      return String(logs);
    } catch (err: any) {
      console.error(`[docker] getLogs failed for ${containerId}:`, err.message);
      return `Error fetching logs: ${err.message}`;
    }
  }

  async getStats(containerId: string): Promise<ContainerStatsI | null> {
    try {
      const container = docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });

      // CPU
      const cpuDelta =
        stats.cpu_stats.cpu_usage.total_usage -
        stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta =
        stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent =
        systemDelta > 0
          ? (cpuDelta / systemDelta) * (stats.cpu_stats.online_cpus || 1) * 100
          : 0;

      // Memory
      const memUsage =
        stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
      const memPercent =
        stats.memory_stats.limit > 0
          ? (memUsage / stats.memory_stats.limit) * 100
          : 0;

      // Network
      let rx = 0;
      let tx = 0;
      if (stats.networks) {
        for (const net of Object.values(stats.networks) as any[]) {
          rx += net.rx_bytes || 0;
          tx += net.tx_bytes || 0;
        }
      }

      return {
        cpu: Math.round(cpuPercent * 100) / 100,
        memory: {
          used: memUsage,
          total: stats.memory_stats.limit,
          percent: Math.round(memPercent * 100) / 100,
        },
        network: { rx, tx },
      };
    } catch (err: any) {
      console.error(
        `[docker] getStats failed for ${containerId}:`,
        err.message,
      );
      return null;
    }
  }

  async listManaged(): Promise<any[]> {
    return docker.listContainers({
      all: true,
      filters: { label: ["deploykit.managed=true"] },
    });
  }

  private demuxStream(buffer: Buffer | string): string {
    if (typeof buffer === "string") return buffer;
    const lines: string[] = [];
    let offset = 0;
    while (offset < buffer.length) {
      if (offset + 8 > buffer.length) break;
      const size = buffer.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size > buffer.length) break;
      lines.push(buffer.subarray(offset, offset + size).toString("utf-8"));
      offset += size;
    }
    return lines.join("");
  }

  async imageExistsLocally(imageName: string): Promise<boolean> {
    try {
      await docker.getImage(imageName).inspect();
      return true;
    } catch {
      return false;
    }
  }
}
