import { describe, it, expect } from "vitest";

import {
  addGameModSchema,
  createGameServerSchema,
  gameSpecSchema,
  MODPACK_VARIABLES,
  validateGameValues,
} from "@deploykit/shared";

/**
 * The game definition contract (`game.json`) and the validation of the values
 * a user enters in the form generated from it. Both live in packages/shared so
 * the web form and the API agree; the API is the authority.
 */

const MINECRAFT = {
  id: "minecraft-java",
  name: "Minecraft: Java Edition",
  version: "1",
  description: "Vanilla or Paper server.",
  image: "itzg/minecraft-server:${java_tag}",
  ports: [{ name: "game", protocol: "tcp", container: 25565, defaultHost: 25565 }],
  variables: [
    { key: "eula", label: "Accept the EULA", type: "boolean", required: true, default: false },
    {
      key: "java_tag",
      label: "Java",
      type: "select",
      default: "java21",
      options: [
        { label: "Java 21", value: "java21" },
        { label: "Java 17", value: "java17" },
      ],
    },
    { key: "max_players", label: "Max players", type: "number", default: 20, min: 1, max: 500 },
    { key: "seed", label: "World seed", type: "string", editable: false },
    { key: "rcon_password", label: "RCON password", type: "string", secret: true, generator: "${password:24}" },
  ],
  env: {
    EULA: "${eula}",
    MAX_PLAYERS: "${max_players}",
    SEED: "${seed}",
    MAX_MEMORY: "${dk_heap_mb}M",
    RCON_PASSWORD: "${rcon_password}",
    SERVER_PORT: "${dk_port_game}",
  },
  volumes: [{ name: "data", path: "/data", primary: true }],
  console: { method: "rcon", protocol: "minecraft", port: 25575, passwordVar: "rcon_password" },
  backup: { preCommands: ["save-off"], postCommands: ["save-on"], settleSeconds: 5 },
  configFiles: [{ volume: "data", path: "server.properties", label: "server.properties", language: "properties" }],
  resources: { memoryMb: { min: 1024, recommended: 4096 } },
};

const errorsOf = (spec: unknown): string[] => {
  const result = gameSpecSchema.safeParse(spec);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("gameSpecSchema", () => {
  it("accepts a well-formed definition and fills defaults", () => {
    const spec = gameSpecSchema.parse(MINECRAFT);
    expect(spec.volumes[0]!.browsable).toBe(true);
    expect(spec.volumes[0]!.backup).toEqual({ include: ["."] });
    expect(spec.stop.timeoutSec).toBe(30);
    expect(spec.ports[0]!.matchHost).toBe(false);
  });

  it("refuses a reference to an undeclared variable", () => {
    expect(errorsOf({ ...MINECRAFT, env: { X: "${nope}" } })).toEqual([
      expect.stringContaining("${nope} is not a declared variable"),
    ]);
  });

  it("refuses a helper call outside a generator", () => {
    expect(errorsOf({ ...MINECRAFT, env: { X: "${password:12}" } })[0]).toContain(
      "helpers belong",
    );
  });

  it("refuses a port built-in for a port that does not exist", () => {
    expect(errorsOf({ ...MINECRAFT, env: { X: "${dk_port_query}" } })).toHaveLength(1);
  });

  it("requires the RCON password to be a secret variable", () => {
    const variables = MINECRAFT.variables.map((v) =>
      v.key === "rcon_password" ? { ...v, secret: false } : v,
    );
    expect(errorsOf({ ...MINECRAFT, variables })[0]).toContain("must be a secret");
  });

  it("requires a select to declare options", () => {
    const variables = [{ key: "mode", label: "Mode", type: "select" }];
    expect(errorsOf({ ...MINECRAFT, variables, env: {}, console: { method: "stdin" } })[0]).toContain(
      "needs options",
    );
  });

  it("refuses jwt, domain and email generators", () => {
    for (const generator of ["${jwt:secret}", "${domain}", "${email}"]) {
      const variables = [{ key: "x", label: "X", type: "string", generator }];
      expect(
        gameSpecSchema.safeParse({ ...MINECRAFT, variables, env: {}, console: { method: "none" }, backup: {} })
          .success,
      ).toBe(false);
    }
  });

  it("refuses the same container port twice on one protocol, not across protocols", () => {
    const tcpUdp = [
      { name: "game", protocol: "udp", container: 27015, matchHost: true },
      { name: "rcon", protocol: "tcp", container: 27015, matchHost: true },
    ];
    expect(errorsOf({ ...MINECRAFT, ports: tcpUdp, env: {} })).toEqual([]);

    const twice = [
      { name: "a", protocol: "tcp", container: 25565 },
      { name: "b", protocol: "tcp", container: 25565 },
    ];
    expect(errorsOf({ ...MINECRAFT, ports: twice, env: {} })).toContain("Duplicate port 25565/tcp");
  });

  it("validates offset ports against the port they follow", () => {
    const ports = [
      { name: "game", protocol: "udp", container: 2456 },
      { name: "query", protocol: "udp", container: 2457, offsetOf: "missing", offset: 1 },
    ];
    expect(errorsOf({ ...MINECRAFT, ports, env: {} })[0]).toContain('Unknown port "missing"');
  });

  it("requires exactly one primary volume", () => {
    const volumes = [
      { name: "a", path: "/a" },
      { name: "b", path: "/b" },
    ];
    expect(errorsOf({ ...MINECRAFT, volumes, configFiles: [] })).toContain(
      "Exactly one volume must be primary",
    );
  });

  it("refuses backup commands on a game without a console", () => {
    expect(errorsOf({ ...MINECRAFT, console: { method: "none" } })).toContain(
      "backup commands and stop.command need a console",
    );
  });

  it("refuses a volume path that is not absolute", () => {
    const volumes = [{ name: "data", path: "data", primary: true }];
    expect(gameSpecSchema.safeParse({ ...MINECRAFT, volumes }).success).toBe(false);
  });
});

describe("validateGameValues", () => {
  const spec = gameSpecSchema.parse(MINECRAFT);

  it("applies defaults and lists generated fields on create", () => {
    const result = validateGameValues(spec, { eula: true }, "create");
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({
      eula: "true",
      java_tag: "java21",
      max_players: "20",
      seed: "",
    });
    expect(result.toGenerate).toEqual(["rcon_password"]);
  });

  it("requires a required boolean to be accepted", () => {
    expect(validateGameValues(spec, {}, "create").errors.eula).toContain("must be accepted");
  });

  it("coerces strings from a form and checks ranges and options", () => {
    const result = validateGameValues(
      spec,
      { eula: "true", max_players: "900", java_tag: "java99" },
      "create",
    );
    expect(result.errors).toEqual({
      max_players: "Must be at most 500",
      java_tag: "Not one of the options",
    });
  });

  it("refuses unknown keys and line breaks", () => {
    const result = validateGameValues(spec, { eula: true, seed: "a\nb", other: 1 }, "create");
    expect(result.errors.other).toBe("Unknown setting");
    expect(result.errors.seed).toBe("Cannot contain line breaks");
  });

  it("on update, refuses changing a fixed field but accepts resending it", () => {
    const current = { seed: "42" };
    expect(validateGameValues(spec, { seed: "43" }, "update", current).errors.seed).toContain(
      "cannot be changed",
    );
    const same = validateGameValues(spec, { seed: "42", max_players: 10 }, "update", current);
    expect(same.errors).toEqual({});
    expect(same.values).toEqual({ max_players: "10" });
  });

  it("on update, treats a blank secret as keep-the-current-value", () => {
    const result = validateGameValues(spec, { rcon_password: "" }, "update");
    expect(result.values).toEqual({});
    expect(result.toGenerate).toEqual([]);
  });
});

// ─── Mods ────────────────────────────────────────────────────────────────────

const mcLike = (mods: unknown, extra: Record<string, unknown> = {}) => ({
  id: "mc",
  name: "MC",
  version: "1",
  description: "x",
  image: "img:1",
  ports: [{ name: "game", protocol: "tcp", container: 25565 }],
  volumes: [{ name: "data", path: "/data", primary: true }],
  variables: [
    {
      key: "server_type",
      label: "Type",
      type: "select",
      default: "FABRIC",
      options: [
        { label: "Vanilla", value: "VANILLA" },
        { label: "Fabric", value: "FABRIC" },
      ],
    },
    { key: "mc_version", label: "Version", type: "string", default: "LATEST" },
  ],
  env: { TYPE: "${server_type}", VERSION: "${mc_version}" },
  mods,
  ...extra,
});

const MODS = {
  sources: [
    { source: "modrinth", env: "MODRINTH_PROJECTS" },
    { source: "curseforge", env: "CURSEFORGE_FILES", apiKeyEnv: "CF_API_KEY" },
  ],
  loader: { from: "server_type", map: { FABRIC: { loaders: ["fabric"], kind: "mod" } } },
  gameVersion: { from: "mc_version", aliases: { LATEST: "release" } },
  modpacks: [
    {
      source: "modrinth",
      env: {
        TYPE: "MODRINTH",
        MODRINTH_MODPACK: "${dk_modpack_project}",
        VERSION: "${dk_modpack_game_version}",
      },
    },
  ],
  directories: [{ volume: "data", path: "mods" }],
};

describe("gameSpecSchema mods", () => {
  it("accepts a valid mods block", () => {
    const r = gameSpecSchema.safeParse(mcLike(MODS));
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });

  it("refuses a duplicate source", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({ ...MODS, sources: [MODS.sources[0], MODS.sources[0]] }),
    );
    expect(r.success).toBe(false);
  });

  it("requires appId for steam-workshop and refuses it elsewhere", () => {
    expect(
      gameSpecSchema.safeParse(
        mcLike({ sources: [{ source: "steam-workshop", env: "TMOD_AUTODOWNLOAD" }] }),
      ).success,
    ).toBe(false);
    expect(
      gameSpecSchema.safeParse(
        mcLike({ sources: [{ source: "modrinth", env: "MODRINTH_PROJECTS", appId: 5 }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses a source env that collides with the game's env", () => {
    const r = gameSpecSchema.safeParse(mcLike({ sources: [{ source: "modrinth", env: "TYPE" }] }));
    expect(r.success).toBe(false);
  });

  it("refuses a loader map key that is not an option of the select", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({
        ...MODS,
        loader: { from: "server_type", map: { FORGE: { loaders: ["forge"], kind: "mod" } } },
      }),
    );
    expect(r.success).toBe(false);
  });

  it("refuses a modpack from an undeclared source", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({
        ...MODS,
        sources: [MODS.sources[0]],
        modpacks: [{ source: "curseforge", env: { TYPE: "AUTO_CURSEFORGE" } }],
      }),
    );
    expect(r.success).toBe(false);
  });

  it("allows dk_modpack_* only inside modpacks[].env", () => {
    const r = gameSpecSchema.safeParse(
      mcLike(MODS, { env: { TYPE: "${server_type}", X: "${dk_modpack_project}" } }),
    );
    expect(r.success).toBe(false);
    expect(MODPACK_VARIABLES).toContain("dk_modpack_game_version");
  });

  it("refuses a directory on an unknown volume", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({ ...MODS, directories: [{ volume: "nope", path: "mods" }] }),
    );
    expect(r.success).toBe(false);
  });

  it("accepts the exec console and lets it satisfy backup commands", () => {
    const r = gameSpecSchema.safeParse(
      mcLike(undefined, {
        console: { method: "exec", command: ["inject"] },
        backup: { preCommands: ["save"] },
      }),
    );
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });
});

describe("mod inputs", () => {
  it("bounds the pasted reference", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(addGameModSchema.safeParse({ id, source: "modrinth", ref: "lithium" }).success).toBe(true);
    expect(addGameModSchema.safeParse({ id, source: "modrinth", ref: "" }).success).toBe(false);
    expect(addGameModSchema.safeParse({ id, source: "nope", ref: "x" }).success).toBe(false);
  });
});

describe("gameSpecSchema contract", () => {
  /** A definition for an image that follows the DeployKit game image contract. */
  const CONTRACT = {
    id: "minecraft-java",
    name: "Minecraft: Java Edition",
    version: "3",
    description: "Minecraft on the DeployKit image.",
    contract: 1,
    image: "ghcr.io/deploykithq/game-minecraft-java:0.1-${java_tag}",
    ports: [{ name: "game", protocol: "tcp", container: 25565 }],
    variables: [
      { key: "type", label: "Type", type: "select", default: "paper", options: [{ label: "Paper", value: "paper" }, { label: "Fabric", value: "fabric" }] },
      { key: "java_tag", label: "Java", type: "select", default: "java25", options: [{ label: "Java 25", value: "java25" }] },
      { key: "mc_version", label: "Version", type: "string", default: "LATEST" },
    ],
    env: { DK_GAME_VERSION: "${mc_version}" },
    volumes: [
      { name: "data", path: "/data", primary: true },
      { name: "server", path: "/server", browsable: false, backup: false },
    ],
    console: { method: "stdin" },
    stop: { timeoutSec: 65 },
    readyPattern: "\\[deploykit\\] ready",
    backup: { preCommands: ["/dk save-off", "/dk save"], postCommands: ["/dk save-on"] },
    mods: {
      sources: [
        { source: "modrinth", env: "DK_MODS_MODRINTH" },
        { source: "curseforge", env: "DK_MODS_CURSEFORGE", apiKeyEnv: "DK_CURSEFORGE_API_KEY" },
      ],
      loader: { from: "type", map: { fabric: { loaders: ["fabric"], kind: "mod" } } },
      modpacks: [
        {
          source: "modrinth",
          env: {
            DK_MODPACK_SOURCE: "modrinth",
            DK_MODPACK_PROJECT: "${dk_modpack_project}",
            DK_MODPACK_VERSION: "${dk_modpack_version}",
          },
        },
      ],
    },
  };

  it("accepts a definition that leaves the inputs to DeployKit", () => {
    expect(errorsOf(CONTRACT)).toEqual([]);
    expect(gameSpecSchema.parse(CONTRACT).contract).toBe(1);
  });

  it("knows only version 1", () => {
    expect(errorsOf({ ...CONTRACT, contract: 2 })).not.toEqual([]);
  });

  it("insists on the stdin console and lets the image stop the game", () => {
    expect(errorsOf({ ...CONTRACT, console: { method: "none" } }).join()).toMatch(/stdin/);
    expect(errorsOf({ ...CONTRACT, stop: { timeoutSec: 65, command: "stop" } }).join()).toMatch(/SIGTERM/);
    expect(errorsOf({ ...CONTRACT, stop: { timeoutSec: 65, signal: "SIGINT" } }).join()).toMatch(/SIGTERM/);
    // Docker must outlast the supervisor's own timeout plus its SIGKILL grace.
    expect(errorsOf({ ...CONTRACT, stop: { timeoutSec: 15 } }).join()).toMatch(/At least 20/);
    expect(errorsOf({ ...CONTRACT, command: ["java", "-jar"] }).join()).toMatch(/no command/);
    expect(errorsOf({ ...CONTRACT, readyPattern: "Done \\(" }).join()).toMatch(/readiness/);
  });

  it("keeps the /data and /server layout", () => {
    const volumes = (v: unknown[]) => errorsOf({ ...CONTRACT, volumes: v }).join();
    expect(volumes([{ name: "data", path: "/config", primary: true }])).toMatch(/primary volume/);
    expect(volumes([CONTRACT.volumes[0], { name: "x", path: "/opt/game", backup: false }])).toMatch(/only/);
    expect(volumes([CONTRACT.volumes[0], { name: "server", path: "/server" }])).toMatch(/backup false/);
  });

  it("refuses to set the DK_* inputs DeployKit injects", () => {
    expect(errorsOf({ ...CONTRACT, env: { DK_VAR_TYPE: "paper" } }).join()).toMatch(/DK_GAME_VERSION/);
    expect(errorsOf({ ...CONTRACT, env: { DK_STOP_TIMEOUT: "5" } })).not.toEqual([]);
    expect(
      errorsOf({ ...CONTRACT, ports: [{ ...CONTRACT.ports[0], env: "SERVER_PORT" }] }).join(),
    ).toMatch(/DK_PORT_GAME/);
  });

  it("needs lower-case keys so each maps to one DK_VAR_<KEY>", () => {
    const variables = [...CONTRACT.variables, { key: "Seed", label: "Seed", type: "string" }];
    expect(errorsOf({ ...CONTRACT, variables }).join()).toMatch(/lower case/);
  });

  it("reads mods and modpacks from the contract's variables", () => {
    const sources = [{ source: "modrinth", env: "MODRINTH_PROJECTS" }];
    expect(errorsOf({ ...CONTRACT, mods: { ...CONTRACT.mods, sources } }).join()).toMatch(
      /DK_MODS_MODRINTH/,
    );
    const noKey = [{ source: "curseforge", env: "DK_MODS_CURSEFORGE" }, CONTRACT.mods.sources[0]];
    expect(errorsOf({ ...CONTRACT, mods: { ...CONTRACT.mods, sources: noKey } }).join()).toMatch(
      /DK_CURSEFORGE_API_KEY/,
    );
    const modpacks = [{ source: "modrinth", env: { TYPE: "MODRINTH", DK_MODPACK_SOURCE: "curseforge" } }];
    const errors = errorsOf({ ...CONTRACT, mods: { ...CONTRACT.mods, modpacks } }).join();
    expect(errors).toMatch(/DK_MODPACK_PROJECT/);
    expect(errors).toMatch(/Must be "modrinth"/);
  });
});

describe("createGameServerSchema", () => {
  const input = {
    projectId: "00000000-0000-4000-8000-000000000000",
    name: "mc",
    gameId: "minecraft",
    memoryMb: 2048,
  };

  // Older clients (and the API itself) keep starting the server on creation.
  it("starts the server unless told otherwise", () => {
    expect(createGameServerSchema.parse(input).start).toBe(true);
    expect(createGameServerSchema.parse({ ...input, start: false }).start).toBe(false);
  });
});
