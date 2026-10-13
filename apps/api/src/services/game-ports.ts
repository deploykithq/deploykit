import { and, eq, ne } from "drizzle-orm";

import { db } from "../db/index";
import { gameServerPorts } from "../db/schema/index";
import { docker } from "../lib/docker";

import type { GamePortT } from "@deploykit/shared";

/**
 * Host port allocation for game servers.
 *
 * Applications are reached through Traefik on 80/443, so nothing else in
 * DeployKit hands out host ports. Game clients connect straight to a host
 * port, often over UDP, so a game server needs one of its own — and two
 * servers must never be handed the same one.
 *
 * The plan is computed by a pure function against a set of ports already in
 * use; the unique index on `game_server_ports` is the final arbiter when two
 * creations race.
 */

type ProtocolT = "tcp" | "udp";

/** A host port and protocol, as "25565/tcp". */
type PortKeyT = string;

const portKey = (port: number, protocol: ProtocolT): PortKeyT =>
  `${port}/${protocol}`;

/** Ports the API, its database, Redis, SSH and Traefik already sit on. */
const RESERVED_PORTS = [22, 80, 443, 3001, 5432, 6379, 8080];

const portRange = (): { from: number; to: number } => {
  const match = /^(\d+)-(\d+)$/.exec(process.env.GAME_PORT_RANGE ?? "");
  const from = match ? Number(match[1]) : 20000;
  const to = match ? Number(match[2]) : 40000;
  return from >= 1 && to <= 65535 && from < to
    ? { from, to }
    : { from: 20000, to: 40000 };
};

interface PlannedPortI {
  name: string;
  protocol: ProtocolT;
  /** The port the server listens on in the container. */
  container: number;
  host: number;
}

interface PortConflictI {
  name: string;
  protocol: ProtocolT;
  port: number;
  /** A host port that would work instead, when one exists in the range. */
  suggestion?: number;
}

const isPortFree = (used: Set<PortKeyT>, port: number, protocol: ProtocolT) =>
  port >= 1 && port <= 65535 && !used.has(portKey(port, protocol));

/**
 * Decide the host port of every port a game declares.
 *
 * A port takes the user's override, else its `defaultHost`, else its
 * container port. A port with `offsetOf` is never chosen directly: it follows
 * its base port (Valheim's query port is always game port + 1), so the pair
 * stays consecutive whatever the user picks. With `matchHost` the container
 * listens on the host port too.
 */
const resolvePortPlan = (
  ports: GamePortT[],
  overrides: Record<string, number>,
  used: Set<PortKeyT>,
  range = portRange(),
): { plan: PlannedPortI[]; conflicts: PortConflictI[] } => {
  const plan: PlannedPortI[] = [];
  const conflicts: PortConflictI[] = [];
  const taken = new Set(used);

  const followers = (base: GamePortT) =>
    ports.filter((p) => p.offsetOf === base.name);

  /** Is `host` usable for `base` and every port that follows it? */
  const fits = (base: GamePortT, host: number) =>
    isPortFree(taken, host, base.protocol) &&
    followers(base).every((f) => isPortFree(taken, host + f.offset!, f.protocol));

  const suggest = (base: GamePortT): number | undefined => {
    for (let p = range.from; p <= range.to; p++) {
      if (fits(base, p)) return p;
    }
    return undefined;
  };

  const place = (port: GamePortT, host: number) => {
    plan.push({
      name: port.name,
      protocol: port.protocol,
      container: port.matchHost ? host : port.container,
      host,
    });
    taken.add(portKey(host, port.protocol));
  };

  for (const base of ports.filter((p) => p.offsetOf === undefined)) {
    const requested = overrides[base.name] ?? base.defaultHost ?? base.container;

    if (!fits(base, requested)) {
      // Name the port that actually collides: the base or one of its followers.
      const clash =
        [base, ...followers(base)].find((p) => {
          const host = p === base ? requested : requested + p.offset!;
          return !isPortFree(taken, host, p.protocol);
        }) ?? base;
      const clashPort = clash === base ? requested : requested + clash.offset!;
      const suggestion = suggest(base);
      conflicts.push({
        name: clash.name,
        protocol: clash.protocol,
        port: clashPort,
        ...(suggestion !== undefined
          ? { suggestion: clash === base ? suggestion : suggestion + clash.offset! }
          : {}),
      });
      continue;
    }

    place(base, requested);
    for (const follower of followers(base)) place(follower, requested + follower.offset!);
  }

  // Keep the declaration order, which is what the UI lists.
  const order = new Map(ports.map((p, i) => [p.name, i]));
  plan.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  return { plan, conflicts };
};

/** One readable sentence for a CONFLICT error. */
const describeConflicts = (conflicts: PortConflictI[]): string =>
  conflicts
    .map(
      (c) =>
        `Port ${c.port}/${c.protocol} (${c.name}) is already in use` +
        (c.suggestion !== undefined ? `; ${c.suggestion} is free` : ""),
    )
    .join(". ");

/**
 * Every host port in use on the local daemon, from three sources: ports held
 * by game servers (running or not, so a stopped server keeps its address),
 * ports published by running containers (domain-less apps, Compose stacks,
 * anything started by hand), and ports DeployKit itself depends on.
 *
 * `exceptGameServerId` leaves out a server's own ports, so an update can keep
 * them.
 */
const collectUsedPorts = async (
  serverKey: string,
  exceptGameServerId?: string,
): Promise<Set<PortKeyT>> => {
  const used = new Set<PortKeyT>();
  for (const port of RESERVED_PORTS) {
    used.add(portKey(port, "tcp"));
    used.add(portKey(port, "udp"));
  }

  const rows = await db
    .select({ hostPort: gameServerPorts.hostPort, protocol: gameServerPorts.protocol })
    .from(gameServerPorts)
    .where(
      exceptGameServerId
        ? and(
            eq(gameServerPorts.serverKey, serverKey),
            ne(gameServerPorts.gameServerId, exceptGameServerId),
          )
        : eq(gameServerPorts.serverKey, serverKey),
    );
  for (const row of rows) used.add(portKey(row.hostPort, row.protocol));

  try {
    const containers = await docker.listContainers({ all: false });
    for (const c of containers) {
      if (exceptGameServerId && c.Labels?.["deploykit.service"] === exceptGameServerId) {
        continue;
      }
      for (const p of c.Ports ?? []) {
        if (p.PublicPort && (p.Type === "tcp" || p.Type === "udp")) {
          used.add(portKey(p.PublicPort, p.Type));
        }
      }
    }
  } catch {
    // Without the daemon the container cannot be created either; creation
    // reports that more usefully than this would.
  }

  return used;
};

export {
  resolvePortPlan,
  describeConflicts,
  collectUsedPorts,
  isPortFree,
  portKey,
  RESERVED_PORTS,
  type PlannedPortI,
  type PortConflictI,
  type PortKeyT,
};
