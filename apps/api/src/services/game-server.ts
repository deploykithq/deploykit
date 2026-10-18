import * as fs from "fs";
import * as path from "path";
import { eq } from "drizzle-orm";

import {
  CONTRACT_STOP_MARGIN_SEC,
  contractPortEnv,
  contractVarEnv,
  validateGameValues,
  type CreateGameServerInputT,
  type GameSpecT,
  type UpdateGameServerInputT,
} from "@deploykit/shared";

import { db } from "../db/index";
import { gameServers, gameServerPorts } from "../db/schema/index";
import { docker } from "../lib/docker";
import { GAME_HARDENING, GAME_NETWORK } from "../lib/game-isolation";
import { emitServiceStatus } from "../lib/socket";
import { encryptEnvVars, decryptEnvVars } from "../lib/encryption";

import { getDockerForServer } from "./docker-factory";
import { getGame } from "./game-catalog";
import { forgetConsole, isRunning, sendConsoleCommand } from "./game-console";
import { loadModEnv, resolveModpack } from "./game-mods";
import { modEnvForProvision, snapshotModEnv } from "./game-mods-env";
import {
  collectUsedPorts,
  describeConflicts,
  resolvePortPlan,
  type PlannedPortI,
} from "./game-ports";
import { resolveHostAddress } from "./stack-domain";
import { resolveVariables, substitute } from "./template-variables";

import type { GameServerT, GameServerPortT } from "../db/schema/index";

/**
 * Game servers: one container per server, built from a game definition.
 *
 * Every container, volume and helper is named `dk-gs-<name>…`. The `gs`
 * keeps them apart from databases and stacks, which use `dk-<name>`: a game
 * server called "postgres" must not collide with a database called the same.
 *
 * v1 runs game servers on the local daemon only. The console, file manager
 * and backups talk to dockerode directly; `server_id` is kept so remote
 * servers can be added without a migration.
 */

/** Where a game server's ports are recorded, until remote servers exist. */
const LOCAL_SERVER_KEY = "local";



/** Docker image reference, checked after `${var}` substitution. */
const IMAGE_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]{0,499}$/;

/** Backups live beside the database ones; `@` cannot start a database name. */
const GAME_BACKUP_ROOT = "/var/backups/deploykit/@games";

const gameContainerName = (name: string) => `dk-gs-${name}`;
const gameVolumeName = (name: string, volume: string) => `dk-gs-${name}-${volume}`;
const gameBackupDir = (id: string) => path.posix.join(GAME_BACKUP_ROOT, id);

type GameServerErrorCodeT = "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT";

/** A failure worth showing a user; the router maps `code` to a tRPC error. */
class GameServerError extends Error {
  constructor(
    readonly code: GameServerErrorCodeT,
    message: string,
  ) {
    super(message);
    this.name = "GameServerError";
  }
}

const readSecrets = (row: Pick<GameServerT, "secretConfig">): Record<string, string> =>
  row.secretConfig ? decryptEnvVars(row.secretConfig) : {};

/** Every variable's value, plain and secret, by key. */
const allValues = (row: Pick<GameServerT, "config" | "secretConfig">) => ({
  ...row.config,
  ...readSecrets(row),
});

/** Split values into the plain `config` and the encrypted `secret_config`. */
const splitValues = (
  spec: Pick<GameSpecT, "variables">,
  values: Record<string, string>,
): { config: Record<string, string>; secrets: Record<string, string> } => {
  const secretKeys = new Set(spec.variables.filter((v) => v.secret).map((v) => v.key));
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    (secretKeys.has(key) ? secrets : config)[key] = value;
  }
  return { config, secrets };
};

const formatValueErrors = (
  spec: Pick<GameSpecT, "variables">,
  errors: Record<string, string>,
): string =>
  Object.entries(errors)
    .map(([key, message]) => {
      const label = spec.variables.find((v) => v.key === key)?.label ?? key;
      return message.startsWith(label) ? message : `${label}: ${message}`;
    })
    .join("; ");

interface PortRowI {
  name: string;
  protocol: "tcp" | "udp";
  containerPort: number;
  hostPort: number;
}

const toPortRows = (plan: PlannedPortI[]): PortRowI[] =>
  plan.map((p) => ({
    name: p.name,
    protocol: p.protocol,
    containerPort: p.container,
    hostPort: p.host,
  }));

/**
 * The values `${name}` may reference: the user's, plus DeployKit's built-ins.
 * A declared variable with no stored value (an optional field left blank)
 * resolves to "" rather than failing the whole container.
 */
const substitutionValues = (
  row: Pick<GameServerT, "name" | "memoryMb"> & { spec: Pick<GameSpecT, "variables"> },
  values: Record<string, string>,
  ports: PortRowI[],
): Record<string, string> => ({
  ...Object.fromEntries(row.spec.variables.map((v) => [v.key, ""])),
  ...values,
  dk_server_name: row.name,
  dk_memory_mb: String(row.memoryMb),
  dk_heap_mb: String(Math.floor(row.memoryMb * 0.75)),
  ...Object.fromEntries(ports.map((p) => [`dk_port_${p.name}`, String(p.hostPort)])),
});

/**
 * The inputs DeployKit owes an image that follows the game image contract:
 * every variable as `DK_VAR_<KEY>`, every port as the number to listen on
 * inside the container (the host port for `matchHost`), and a stop timeout
 * that leaves Docker time for the supervisor's own SIGTERM and SIGKILL.
 */
const contractEnv = (
  row: Pick<GameServerT, "name" | "memoryMb"> & { spec: GameSpecT },
  values: Record<string, string>,
  ports: PortRowI[],
): Record<string, string> => ({
  DK_SERVER_NAME: row.name,
  DK_MEMORY_MB: String(row.memoryMb),
  DK_HEAP_MB: String(Math.floor(row.memoryMb * 0.75)),
  DK_STOP_TIMEOUT: String(row.spec.stop.timeoutSec - CONTRACT_STOP_MARGIN_SEC),
  ...Object.fromEntries(ports.map((p) => [contractPortEnv(p.name), String(p.containerPort)])),
  ...Object.fromEntries(row.spec.variables.map((v) => [contractVarEnv(v.key), values[v.key] ?? ""])),
});

const resolveImage = (spec: GameSpecT, values: Record<string, string>): string => {
  const image = substitute(spec.image, values);
  if (!IMAGE_REGEX.test(image)) {
    throw new GameServerError("BAD_REQUEST", `"${image}" is not a valid image reference`);
  }
  return image;
};

/**
 * Everything `createAndStart` needs, derived from the row alone. Pure, so the
 * invariants (labels, stdin without TTY, secrets only in Env) are testable.
 */
const buildContainerSpec = (
  row: Pick<
    GameServerT,
    "id" | "name" | "projectId" | "gameId" | "spec" | "memoryMb" | "cpuMillicores"
  >,
  values: Record<string, string>,
  ports: PortRowI[],
  /** Rendered by game-mods: mod lists, the modpack's env, a CurseForge key. */
  modEnv: Record<string, string> = {},
) => {
  const spec = row.spec;
  const subst = substitutionValues(row, values, ports);

  const env: Record<string, string> = spec.contract ? contractEnv(row, values, ports) : {};
  for (const [key, value] of Object.entries(spec.env)) env[key] = substitute(value, subst);
  for (const port of spec.ports) {
    const allocated = ports.find((p) => p.name === port.name);
    if (port.env && allocated) env[port.env] = String(allocated.hostPort);
  }
  // After the game's own env: a modpack's TYPE replaces the server type.
  Object.assign(env, modEnv);

  return {
    name: gameContainerName(row.name),
    image: resolveImage(spec, subst),
    env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    ...(spec.command ? { command: spec.command.map((c) => substitute(c, subst)) } : {}),
    ports: ports.map((p) => ({
      host: p.hostPort,
      container: p.containerPort,
      protocol: p.protocol,
    })),
    volumes: spec.volumes.map((v) => `${gameVolumeName(row.name, v.name)}:${v.path}`),
    networkName: GAME_NETWORK,
    exclusiveNetwork: true,
    ...GAME_HARDENING,
    labels: {
      "deploykit.managed": "true",
      "deploykit.type": "game_server",
      "deploykit.project": row.projectId,
      "deploykit.service": row.id,
      "deploykit.game": row.gameId,
    },
    restartPolicy: "unless-stopped",
    openStdin: spec.console.method === "stdin",
    ...(spec.stop.signal ? { stopSignal: spec.stop.signal } : {}),
    stopTimeout: spec.stop.timeoutSec,
    memoryMb: row.memoryMb,
    ...(row.cpuMillicores ? { cpuMillicores: row.cpuMillicores } : {}),
  };
};

const loadPorts = async (gameServerId: string): Promise<GameServerPortT[]> =>
  db.query.gameServerPorts.findMany({
    where: eq(gameServerPorts.gameServerId, gameServerId),
  });

const setStatus = async (id: string, status: string, extra: Partial<GameServerT> = {}) => {
  await db
    .update(gameServers)
    .set({ status, statusMessage: null, updatedAt: new Date(), ...extra })
    .where(eq(gameServers.id, id));
  emitServiceStatus(id, status);
};

/**
 * Refuse to touch a container that has our name but is not ours.
 *
 * Application names are free-form, so an app called "gs-mc" runs as
 * `dk-gs-mc` — the name game server "mc" would use. `createAndStart` removes
 * any container with the target name, so without this check provisioning
 * would delete someone else's service.
 */
const assertNameIsOurs = async (name: string, gameServerId: string): Promise<void> => {
  try {
    const info = await docker.getContainer(name).inspect();
    if (info.Config?.Labels?.["deploykit.service"] !== gameServerId) {
      throw new GameServerError(
        "CONFLICT",
        `A container named "${name}" already exists and belongs to another service. Rename the game server.`,
      );
    }
  } catch (err: any) {
    if (err instanceof GameServerError) throw err;
    // 404: the name is free.
  }
};

/**
 * Create (or replace) the server's container and start it.
 *
 * `mods: "current"` builds it with the mod list as it is now — only the
 * apply-mods job asks for that, after its safety backup. Every other rebuild
 * keeps the mods that were applied last, so a settings change cannot roll
 * out pending (possibly destructive) mod changes on the side.
 */
const provisionGameContainer = async (
  row: GameServerT,
  { mods: modsMode = "applied" }: { mods?: "current" | "applied" } = {},
): Promise<string> => {
  const ports = await loadPorts(row.id);
  const mods = await loadModEnv(row);
  const modEnv = modEnvForProvision(mods, row.appliedModEnv, modsMode);
  const opts = buildContainerSpec(row, allValues(row), ports, modEnv);
  try {
    await assertNameIsOurs(opts.name, row.id);
  } catch (err: any) {
    await setStatus(row.id, "error", { statusMessage: err.message });
    throw err;
  }

  forgetConsole(row.containerId);
  const { docker: local } = await getDockerForServer(null);
  try {
    const containerId = await local.createAndStart(opts);
    await setStatus(row.id, "running", {
      containerId,
      image: opts.image,
      appliedModEnv:
        modsMode === "current" || !row.appliedModEnv ? snapshotModEnv(mods) : row.appliedModEnv,
    });
    return containerId;
  } catch (err: any) {
    const raw = String(err?.message ?? err);
    const error = /port is already allocated|address already in use/i.test(raw)
      ? new GameServerError(
          "CONFLICT",
          "A host port of this server is taken by something outside DeployKit. Change the port in Settings.",
        )
      : err;
    await setStatus(row.id, "error", { statusMessage: String(error?.message ?? error) });
    throw error;
  }
};

/**
 * Provision without holding the request open: pulling a game image can take
 * minutes. The row reads `provisioning` meanwhile, then `running` or `error`
 * with the reason in `status_message`.
 */
const provisionInBackground = (row: GameServerT): void => {
  void setStatus(row.id, "provisioning")
    .then(() => provisionGameContainer(row))
    .catch((err) => {
      console.error(`[games] Provisioning ${row.name} failed: ${err?.message ?? err}`);
    });
};

const isUniqueViolation = (err: any) =>
  err?.code === "23505" || err?.cause?.code === "23505";

/** Throws when the server is meant to run somewhere other than this host. */
const assertLocal = async (serverId: string | null | undefined) => {
  if (!serverId) return;
  const { isRemote } = await getDockerForServer(serverId);
  if (isRemote) {
    throw new GameServerError(
      "BAD_REQUEST",
      "Game servers run on the local server in this version",
    );
  }
};

/**
 * Create a game server and, unless `start` is false, start it.
 *
 * The container is provisioned in the background (see provisionInBackground);
 * if that fails the row is kept in `error` so Start can retry. Without
 * `start` the row stays `idle` with no container, so mods can be added before
 * the first start generates the world.
 *
 * @returns the row and the secrets that were generated (shown to the user once).
 */
const createGameServer = async (input: CreateGameServerInputT) => {
  await assertLocal(input.serverId);

  const spec = await getGame(input.gameId);
  if (!spec) throw new GameServerError("NOT_FOUND", "Game not found in the catalogue");

  if (input.memoryMb < spec.resources.memoryMb.min) {
    throw new GameServerError(
      "BAD_REQUEST",
      `${spec.name} needs at least ${spec.resources.memoryMb.min} MB of memory`,
    );
  }

  const checked = validateGameValues(spec, input.values, "create");
  if (Object.keys(checked.errors).length > 0) {
    throw new GameServerError("BAD_REQUEST", formatValueErrors(spec, checked.errors));
  }

  const modpack = input.modpack ? await resolveModpack(spec, input.modpack) : null;

  const generators = Object.fromEntries(
    checked.toGenerate.map((key) => [
      key,
      spec.variables.find((v) => v.key === key)!.generator!,
    ]),
  );
  const generated = resolveVariables(generators, { domain: "localhost" });
  const { config, secrets } = splitValues(spec, { ...checked.values, ...generated });

  const existing = await db.query.gameServers.findFirst({
    where: eq(gameServers.name, input.name),
    columns: { id: true },
  });
  if (existing) {
    throw new GameServerError("CONFLICT", `A game server named "${input.name}" already exists`);
  }
  // No row has this id yet, so any container with the name is someone else's.
  await assertNameIsOurs(gameContainerName(input.name), "");

  const { plan, conflicts } = resolvePortPlan(
    spec.ports,
    input.ports ?? {},
    await collectUsedPorts(LOCAL_SERVER_KEY),
  );
  if (conflicts.length > 0) {
    throw new GameServerError("CONFLICT", describeConflicts(conflicts));
  }
  const portRows = toPortRows(plan);

  // Resolve the image now so a bad select value fails before anything exists.
  const image = resolveImage(
    spec,
    substitutionValues(
      { name: input.name, memoryMb: input.memoryMb, spec },
      { ...config, ...secrets },
      portRows,
    ),
  );

  let row: GameServerT;
  try {
    row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(gameServers)
        .values({
          projectId: input.projectId,
          serverId: input.serverId ?? null,
          name: input.name,
          gameId: spec.id,
          gameName: spec.name,
          specVersion: spec.version,
          spec,
          image,
          config,
          secretConfig: Object.keys(secrets).length > 0 ? encryptEnvVars(secrets) : null,
          memoryMb: input.memoryMb,
          cpuMillicores: input.cpuMillicores ?? null,
          modpack,
          status: input.start ? "provisioning" : "idle",
        })
        .returning();
      await tx.insert(gameServerPorts).values(
        portRows.map((p) => ({
          ...p,
          gameServerId: created!.id,
          serverKey: LOCAL_SERVER_KEY,
        })),
      );
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new GameServerError(
        "CONFLICT",
        "That name or one of those ports was just taken. Try again.",
      );
    }
    throw err;
  }

  if (input.start) provisionInBackground(row);

  return {
    row,
    generatedSecrets: Object.fromEntries(
      Object.keys(generated)
        .filter((key) => key in secrets)
        .map((key) => [key, secrets[key]!]),
    ),
  };
};

const startGameServer = async (row: GameServerT): Promise<{ provisioned: boolean }> => {
  if (row.containerId) {
    try {
      await docker.getContainer(row.containerId).start();
      await setStatus(row.id, "running");
      return { provisioned: false };
    } catch (err: any) {
      if (err?.statusCode === 304) {
        await setStatus(row.id, "running");
        return { provisioned: false };
      }
      if (err?.statusCode !== 404) throw err;
      // The container is gone (pruned, or removed by hand): build it again.
    }
  }
  provisionInBackground(row);
  return { provisioned: true };
};

const waitForExit = async (containerId: string, timeoutSec: number) => {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (!(await isRunning(containerId))) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

/**
 * Stop the server gracefully.
 *
 * A game with a `stop.command` is asked to shut down through its console
 * first, so it saves the world itself. With `unless-stopped` an exit Docker
 * did not cause would be restarted, so the restart policy is lifted for the
 * duration and put back afterwards.
 */
const stopContainerGracefully = async (row: GameServerT): Promise<void> => {
  if (!row.containerId) return;
  const container = docker.getContainer(row.containerId);
  const timeoutSec = row.spec.stop.timeoutSec;

  if (
    row.spec.stop.command &&
    row.spec.console.method !== "none" &&
    (await isRunning(row.containerId))
  ) {
    await container.update({ RestartPolicy: { Name: "no" } } as any).catch(() => {});
    try {
      await sendConsoleCommand(row, row.spec.stop.command);
      await waitForExit(row.containerId, timeoutSec);
    } catch {
      // Fall back to a signal below.
    } finally {
      await container
        .update({ RestartPolicy: { Name: "unless-stopped" } } as any)
        .catch(() => {});
    }
  }

  await container.stop({ t: timeoutSec }).catch((err: any) => {
    if (err?.statusCode !== 304 && err?.statusCode !== 404) throw err;
  });
  forgetConsole(row.containerId);
};

const stopGameServer = async (row: GameServerT): Promise<void> => {
  await stopContainerGracefully(row);
  await setStatus(row.id, "stopped");
};

const restartGameServer = async (row: GameServerT): Promise<void> => {
  await stopContainerGracefully(row);
  await startGameServer(row);
};

/**
 * Apply a settings change. Env is baked into a container, so the container is
 * recreated (volumes persist). A stopped server stays stopped.
 *
 * @returns whether the server was restarted to apply the change.
 */
const updateGameServer = async (
  row: GameServerT,
  input: UpdateGameServerInputT,
): Promise<{ restarted: boolean }> => {
  const spec = row.spec;
  let config = row.config;
  let secrets = readSecrets(row);

  if (input.values) {
    const checked = validateGameValues(spec, input.values, "update", { ...config, ...secrets });
    if (Object.keys(checked.errors).length > 0) {
      throw new GameServerError("BAD_REQUEST", formatValueErrors(spec, checked.errors));
    }
    const split = splitValues(spec, checked.values);
    config = { ...config, ...split.config };
    secrets = { ...secrets, ...split.secrets };
  }

  if (input.memoryMb !== undefined && input.memoryMb < spec.resources.memoryMb.min) {
    throw new GameServerError(
      "BAD_REQUEST",
      `${spec.name} needs at least ${spec.resources.memoryMb.min} MB of memory`,
    );
  }

  let portRows: PortRowI[] | null = null;
  if (input.ports) {
    const current = await loadPorts(row.id);
    const overrides = {
      ...Object.fromEntries(current.map((p) => [p.name, p.hostPort])),
      ...input.ports,
    };
    const { plan, conflicts } = resolvePortPlan(
      spec.ports,
      overrides,
      await collectUsedPorts(LOCAL_SERVER_KEY, row.id),
    );
    if (conflicts.length > 0) {
      throw new GameServerError("CONFLICT", describeConflicts(conflicts));
    }
    portRows = toPortRows(plan);
  }

  const next: GameServerT = {
    ...row,
    config,
    secretConfig: Object.keys(secrets).length > 0 ? encryptEnvVars(secrets) : null,
    memoryMb: input.memoryMb ?? row.memoryMb,
    cpuMillicores: input.cpuMillicores === undefined ? row.cpuMillicores : input.cpuMillicores,
  };
  // Fail on a bad image before touching anything.
  next.image = resolveImage(
    spec,
    substitutionValues(next, { ...config, ...secrets }, portRows ?? (await loadPorts(row.id))),
  );

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(gameServers)
        .set({
          config: next.config,
          secretConfig: next.secretConfig,
          memoryMb: next.memoryMb,
          cpuMillicores: next.cpuMillicores,
          image: next.image,
          updatedAt: new Date(),
        })
        .where(eq(gameServers.id, row.id));
      if (portRows) {
        await tx.delete(gameServerPorts).where(eq(gameServerPorts.gameServerId, row.id));
        await tx.insert(gameServerPorts).values(
          portRows.map((p) => ({ ...p, gameServerId: row.id, serverKey: LOCAL_SERVER_KEY })),
        );
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new GameServerError("CONFLICT", "One of those ports was just taken. Try again.");
    }
    throw err;
  }

  return recreateGameServer(row, next);
};

/**
 * Rebuild the container from the row as it is now (settings, mods), keeping
 * it stopped if it was stopped. A server never provisioned is left alone: its
 * first start picks everything up.
 */
const recreateGameServer = async (
  row: GameServerT,
  next: GameServerT = row,
  mods: "current" | "applied" = "applied",
): Promise<{ restarted: boolean }> => {
  if (!row.containerId) return { restarted: false };
  const wasRunning = await isRunning(row.containerId);
  await stopContainerGracefully(row);
  const containerId = await provisionGameContainer(next, { mods });
  if (!wasRunning) {
    await docker.getContainer(containerId).stop({ t: next.spec.stop.timeoutSec }).catch(() => {});
    await setStatus(row.id, "stopped");
  }
  return { restarted: wasRunning };
};

/** Containers DeployKit started on a server's behalf (file manager, backups). */
const removeHelpers = async (gameServerId: string): Promise<void> => {
  const helpers = await docker
    .listContainers({ all: true, filters: { label: [`deploykit.owner=${gameServerId}`] } })
    .catch(() => []);
  await Promise.all(
    helpers.map((h) => docker.getContainer(h.Id).remove({ force: true }).catch(() => {})),
  );
};

/**
 * Remove the server's containers. With `deleteData` its volumes and backups
 * go too; otherwise they are left behind, as a deleted database's volume is.
 */
const removeGameServer = async (row: GameServerT, deleteData: boolean): Promise<void> => {
  await removeHelpers(row.id);
  forgetConsole(row.containerId);

  // By label, not by name: a container that only shares the name (a
  // free-form application name) is not ours to remove.
  const owned = await docker
    .listContainers({ all: true, filters: { label: [`deploykit.service=${row.id}`] } })
    .catch(() => []);
  for (const c of owned) {
    const container = docker.getContainer(c.Id);
    await container.stop({ t: row.spec.stop.timeoutSec }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  }

  if (deleteData) {
    for (const volume of row.spec.volumes) {
      await docker
        .getVolume(gameVolumeName(row.name, volume.name))
        .remove()
        .catch(() => {});
    }
    await fs.promises
      .rm(gameBackupDir(row.id), { recursive: true, force: true })
      .catch(() => {});
  }
};

/** Where players connect: the host's public address and each port. */
const connectInfo = async (ports: GameServerPortT[]) => {
  const host = (await resolveHostAddress(null)) ?? null;
  return ports.map((p) => ({
    name: p.name,
    protocol: p.protocol,
    port: p.hostPort,
    address: host ? `${host}:${p.hostPort}` : null,
  }));
};

export {
  LOCAL_SERVER_KEY,
  GAME_BACKUP_ROOT,
  gameContainerName,
  gameVolumeName,
  gameBackupDir,
  GameServerError,
  readSecrets,
  allValues,
  buildContainerSpec,
  createGameServer,
  provisionGameContainer,
  provisionInBackground,
  startGameServer,
  stopGameServer,
  restartGameServer,
  stopContainerGracefully,
  updateGameServer,
  recreateGameServer,
  removeGameServer,
  removeHelpers,
  connectInfo,
  setStatus as setGameServerStatus,
  loadPorts as loadGameServerPorts,
};
