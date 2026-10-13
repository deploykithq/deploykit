import { describe, it, expect, vi } from "vitest";

import { gameSpecSchema } from "@deploykit/shared";

/**
 * The container a game server runs in, derived from its row. Pure, so the
 * invariants are pinned here: the labels logs and metrics find it by, stdin
 * without a TTY, secrets only in Env, and `dk-gs-` names that cannot collide
 * with a database's `dk-<name>`.
 */

vi.mock("../db/index", () => ({ db: {} }));
vi.mock("../lib/docker", () => ({ docker: {} }));
vi.mock("../lib/socket", () => ({ emitServiceStatus: vi.fn(), emitContainerLog: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: {} }));
vi.mock("./docker-factory", () => ({ getDockerForServer: vi.fn() }));

const { buildContainerSpec, gameContainerName, gameVolumeName } = await import("./game-server");
const { GAME_NETWORK } = await import("../lib/game-isolation");

const spec = gameSpecSchema.parse({
  id: "valheim",
  name: "Valheim",
  version: "1",
  description: "Viking survival.",
  image: "example/valheim:${tag}",
  ports: [
    { name: "game", protocol: "udp", container: 2456, matchHost: true, env: "SERVER_PORT" },
    { name: "query", protocol: "udp", container: 2457, matchHost: true, offsetOf: "game", offset: 1 },
  ],
  variables: [
    { key: "tag", label: "Tag", type: "select", default: "latest", options: [{ label: "latest", value: "latest" }] },
    { key: "server_pass", label: "Password", type: "string", secret: true },
  ],
  env: {
    SERVER_PASS: "${server_pass}",
    NAME: "${dk_server_name}",
    HEAP: "${dk_heap_mb}M",
    QUERY: "${dk_port_query}",
  },
  volumes: [{ name: "config", path: "/config", primary: true }],
  console: { method: "stdin" },
  stop: { timeoutSec: 90, signal: "SIGINT" },
});

const row = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "vikings",
  projectId: "22222222-2222-2222-2222-222222222222",
  gameId: "valheim",
  spec,
  memoryMb: 4000,
  cpuMillicores: null,
};

const ports = [
  { name: "game", protocol: "udp" as const, containerPort: 3000, hostPort: 3000 },
  { name: "query", protocol: "udp" as const, containerPort: 3001, hostPort: 3001 },
];

describe("buildContainerSpec", () => {
  const opts = buildContainerSpec(row, { tag: "latest", server_pass: "s3cret" }, ports);

  it("names everything dk-gs-<name> so it cannot collide with a database", () => {
    expect(opts.name).toBe("dk-gs-vikings");
    expect(gameContainerName("postgres")).not.toBe("dk-postgres");
    expect(opts.volumes).toEqual([`${gameVolumeName("vikings", "config")}:/config`]);
    expect(opts.volumes[0]).toBe("dk-gs-vikings-config:/config");
  });

  it("carries the labels logs, metrics and the socket rooms find it by", () => {
    expect(opts.labels).toEqual({
      "deploykit.managed": "true",
      "deploykit.type": "game_server",
      "deploykit.project": row.projectId,
      "deploykit.service": row.id,
      "deploykit.game": "valheim",
    });
  });

  it("substitutes variables and built-ins into the image and env", () => {
    expect(opts.image).toBe("example/valheim:latest");
    expect(opts.env).toEqual(
      expect.arrayContaining([
        "SERVER_PASS=s3cret",
        "NAME=vikings",
        "HEAP=3000M",
        "QUERY=3001",
        "SERVER_PORT=3000",
      ]),
    );
  });

  it("publishes UDP ports on the allocated host ports", () => {
    expect(opts.ports).toEqual([
      { host: 3000, container: 3000, protocol: "udp" },
      { host: 3001, container: 3001, protocol: "udp" },
    ]);
  });

  it("keeps stdin open for a stdin console and stops gracefully", () => {
    expect(opts.openStdin).toBe(true);
    expect(opts.stopSignal).toBe("SIGINT");
    expect(opts.stopTimeout).toBe(90);
    expect(opts.restartPolicy).toBe("unless-stopped");
    expect(opts.memoryMb).toBe(4000);
    expect(opts).not.toHaveProperty("cpuMillicores");
  });

  it("runs on its own network, away from DeployKit's Redis and Postgres", () => {
    // Mods and plugins are third-party code: on deploykit-network they could
    // reach Redis (the job queues) and Postgres directly.
    expect(opts.networkName).toBe(GAME_NETWORK);
    // ...and only there: not also on Docker's default bridge.
    expect(opts.exclusiveNetwork).toBe(true);
    expect(GAME_NETWORK).not.toBe("deploykit-network");
  });

  it("is hardened: no privilege escalation, no raw sockets, bounded processes", () => {
    expect(opts.securityOpt).toEqual(["no-new-privileges:true"]);
    expect(opts.capDrop).toEqual(expect.arrayContaining(["NET_RAW", "MKNOD"]));
    expect(opts.pidsLimit).toBeGreaterThan(0);
  });

  it("never puts a secret anywhere but Env", () => {
    const { env, ...rest } = opts;
    expect(JSON.stringify(rest)).not.toContain("s3cret");
    expect(env.join("\n")).toContain("s3cret");
  });

  it("does not open stdin for an RCON game", () => {
    const rcon = gameSpecSchema.parse({
      ...spec,
      variables: [...spec.variables, { key: "rcon", label: "RCON", type: "string", secret: true }],
      console: { method: "rcon", protocol: "source", port: 27015, passwordVar: "rcon" },
    });
    expect(buildContainerSpec({ ...row, spec: rcon }, { tag: "latest" }, ports).openStdin).toBe(false);
  });

  it("merges mod env after the game's env so a modpack TYPE wins", () => {
    const withType = { ...row, spec: { ...spec, env: { ...spec.env, TYPE: "VANILLA" } } };
    const merged = buildContainerSpec(withType, { tag: "latest" }, ports, {
      TYPE: "MODRINTH",
      MODRINTH_PROJECTS: "AA:v1",
    });
    expect(merged.env).toContain("TYPE=MODRINTH");
    expect(merged.env).toContain("MODRINTH_PROJECTS=AA:v1");
    expect(merged.env.filter((e: string) => e.startsWith("TYPE="))).toHaveLength(1);
  });

  it("refuses an image that a select value turned into something invalid", () => {
    expect(() => buildContainerSpec(row, { tag: "bad tag" }, ports)).toThrow(
      /not a valid image reference/,
    );
  });
});
