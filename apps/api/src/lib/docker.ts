import Docker from "dockerode";

import { platform } from "os";

const createDockerClient = (): Docker => {
  // Explicit env var takes priority
  if (process.env.DOCKER_SOCKET) {
    return new Docker({ socketPath: process.env.DOCKER_SOCKET });
  }

  // Windows: Docker Desktop uses a named pipe
  if (platform() === "win32") {
    return new Docker({ socketPath: "//./pipe/docker_engine" });
  }

  // Linux/Mac: standard socket
  return new Docker({ socketPath: "/var/run/docker.sock" });
};

const docker = createDockerClient();

const isDockerAvailable = async (): Promise<boolean> => {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
};

const ensureNetwork = async (name: string): Promise<void> => {
  const networks = await docker.listNetworks({
    filters: { name: [name] },
  });

  if (networks.length === 0) {
    await docker.createNetwork({
      Name: name,
      Driver: "bridge",
      CheckDuplicate: true,
    });
    console.log(`Created Docker network: ${name}`);
  }
};

const connectToNetwork = async (
  containerId: string,
  networkName: string,
): Promise<void> => {
  const network = docker.getNetwork(networkName);
  try {
    await network.connect({ Container: containerId });
  } catch (err: any) {
    if (!err.message?.includes("already exists")) throw err;
  }
};

export { docker, isDockerAvailable, ensureNetwork, connectToNetwork };
