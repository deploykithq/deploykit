import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { servers } from "../db/schema/index";
import { DockerService } from "./docker";
import { RemoteDockerService } from "./remote-docker";
import { decrypt } from "../lib/encryption";

// Shared local instance
const localDocker = new DockerService();

/**
 * Common interface for both local and remote Docker operations.
 * Both DockerService and RemoteDockerService implement these methods.
 */
export interface DockerServiceI {
  pullImage(imageName: string): Promise<void>;
  buildImage(
    contextPath: string,
    tag: string,
    dockerfilePath?: string,
    onProgress?: (log: string) => void,
  ): Promise<void>;
  createAndStart(opts: {
    name: string;
    image: string;
    env?: string[];
    ports?: Array<{ host: number; container: number }>;
    volumes?: string[];
    networkName?: string;
    labels?: Record<string, string>;
    command?: string[];
    restartPolicy?: string;
    skipPull?: boolean;
    cpuMillicores?: number;
    memoryMb?: number;
  }): Promise<string>;
  deployApp(opts: {
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
  }): Promise<string>;
  getContainerMounts(containerId: string): Promise<
    Array<{
      source: string;
      destination: string;
      name?: string;
      rw: boolean;
    }>
  >;
  getImageVolumes(imageTag: string): Promise<string[]>;
  start(containerId: string): Promise<void>;
  stop(containerId: string): Promise<void>;
  stopAndRemove(containerId: string): Promise<void>;
  restart(containerId: string): Promise<void>;
  listServiceContainers(
    serviceId: string,
  ): Promise<Array<{ id: string; name: string; state: string }>>;
  startServiceContainers(serviceId: string): Promise<void>;
  stopServiceContainers(serviceId: string): Promise<void>;
  removeServiceContainers(serviceId: string): Promise<void>;
  scaleService(serviceId: string, target: number): Promise<number>;
  getLogs(containerId: string, tail?: number): Promise<string>;
  getStats(containerId: string): Promise<{
    cpu: number;
    memory: { used: number; total: number; percent: number };
    network: { rx: number; tx: number };
  } | null>;
}

/**
 * Returns the appropriate Docker service for a given server ID.
 * - null / undefined / local server → local DockerService (dockerode)
 * - remote server → RemoteDockerService (SSH)
 */
const getDockerForServer = async (
  serverId?: string | null,
): Promise<{ docker: DockerServiceI; isRemote: boolean }> => {
  if (!serverId) {
    return { docker: localDocker, isRemote: false };
  }

  const server = await db.query.servers.findFirst({
    where: eq(servers.id, serverId),
  });

  if (!server || server.isLocal) {
    return { docker: localDocker, isRemote: false };
  }

  // Build SSH opts
  let sshKeyContent = server.sshKeyContent;
  if (sshKeyContent) {
    try {
      sshKeyContent = decrypt(sshKeyContent);
    } catch {
      // might not be encrypted
    }
  }

  const remote = new RemoteDockerService({
    host: server.host,
    port: server.port,
    username: server.username,
    sshKeyPath: server.sshKeyPath,
    sshKeyContent,
  });

  return { docker: remote, isRemote: true };
};

/**
 * Shorthand: get a RemoteDockerService for a specific server.
 * Throws if server not found or is local.
 */
const getRemoteDocker = async (
  serverId: string,
): Promise<RemoteDockerService> => {
  const { docker, isRemote } = await getDockerForServer(serverId);
  if (!isRemote) {
    throw new Error("Server is local — use local DockerService");
  }
  return docker as RemoteDockerService;
};

export { getDockerForServer, getRemoteDocker };
