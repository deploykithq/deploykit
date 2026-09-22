import { DATABASE_IMAGES } from "@deploykit/shared";

import type { ApplicationT, DatabaseT } from "../db/schema/index";
import type { DatabaseType } from "@deploykit/shared";

/**
 * Builds the container spec for a one-off run, and (Task 9) orchestrates one.
 *
 * Every run is a fresh container from the service's image — never a `docker
 * exec` into the live one — so a command works with the app stopped, keeps a
 * long job off the container serving traffic, and needs no choice between
 * replicas.
 *
 * Four differences from a deployed container are load-bearing:
 *   • no published ports — a one-off would collide with the app's host port;
 *   • RestartPolicy "no" — set by the transport, since a finished command must
 *     not be restarted (createAndStart defaults to unless-stopped);
 *   • no `deploykit.service` label — that label is how listServiceContainers,
 *     the autoscaler, the metrics scheduler and the log collector find a
 *     service's replicas; a one-off carrying it would be scaled or scraped;
 *   • the command is wrapped in a shell, so `a && b`, pipes and globs behave
 *     the way a user typing them expects.
 */

const SHARED_NETWORK = "deploykit-network";
const SHELL = "/bin/sh";

class OneOffNotDeployedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OneOffNotDeployedError";
  }
}

interface OneOffSpecI {
  image: string;
  name: string;
  cmd: string[];
  env: string[];
  labels: Record<string, string>;
  volumes?: string[];
  networkName: string;
  cpuMillicores?: number;
  memoryMb?: number;
  timeoutMs: number;
}

type OneOffInputT =
  | {
      kind: "application";
      runId: string;
      command: string;
      timeoutSeconds: number;
      app: ApplicationT;
      env: Record<string, string>;
    }
  | {
      kind: "database";
      runId: string;
      command: string;
      timeoutSeconds: number;
      database: DatabaseT;
      password: string;
    };

/** The env var each client tool reads its password from, so a command never
 *  has to carry the password in its arguments. */
const passwordEnvFor = (type: DatabaseType): string | null => {
  switch (type) {
    case "postgresql":
      return "PGPASSWORD";
    case "mysql":
    case "mariadb":
      return "MYSQL_PWD";
    case "redis":
      return "REDISCLI_AUTH";
    default:
      return null; // mongodb: mongosh takes credentials as arguments
  }
};

const toEnvList = (vars: Record<string, string>): string[] =>
  Object.entries(vars).map(([k, v]) => `${k}=${v}`);

const buildOneOffSpec = (input: OneOffInputT): OneOffSpecI => {
  const name = `dk-oneoff-${input.runId.slice(0, 8)}`;
  const labels: Record<string, string> = {
    "deploykit.managed": "true",
    "deploykit.oneoff": "true",
    "deploykit.run": input.runId,
  };
  const base = {
    name,
    cmd: [SHELL, "-lc", input.command],
    labels,
    networkName: SHARED_NETWORK,
    timeoutMs: input.timeoutSeconds * 1000,
  };

  if (input.kind === "application") {
    if (!input.app.containerImage) {
      throw new OneOffNotDeployedError(
        `Application "${input.app.name}" has no image yet — deploy it once before running commands.`,
      );
    }
    return {
      ...base,
      image: input.app.containerImage,
      env: toEnvList(input.env),
      volumes: input.app.volumes ?? undefined,
      cpuMillicores: input.app.cpuLimit ?? undefined,
      memoryMb: input.app.memoryLimit ?? undefined,
    };
  }

  const type = input.database.type as DatabaseType;
  const image = DATABASE_IMAGES[type]?.image;
  if (!image) {
    throw new OneOffNotDeployedError(
      `Unknown database type "${input.database.type}".`,
    );
  }

  const pwEnv = passwordEnvFor(type);
  return {
    ...base,
    image,
    // The client connects over the shared network; the data volume is
    // deliberately not mounted — two processes must not open the same files.
    env: toEnvList({
      DK_DB_HOST: `dk-${input.database.name}`,
      DK_DB_PORT: String(input.database.internalPort),
      DK_DB_USER: input.database.dbUser ?? "",
      DK_DB_NAME: input.database.databaseName ?? "",
      DK_DB_PASSWORD: input.password,
      ...(pwEnv ? { [pwEnv]: input.password } : {}),
    }),
  };
};

export {
  buildOneOffSpec,
  OneOffNotDeployedError,
  SHARED_NETWORK,
  type OneOffSpecI,
  type OneOffInputT,
};
