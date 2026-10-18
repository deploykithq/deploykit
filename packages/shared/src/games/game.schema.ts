import { z } from "zod";

import { RELATIVE_PATH_REGEX } from "../types";
import {
  TEMPLATE_ID_REGEX,
  TEMPLATE_VARIABLE_SOURCE,
  VARIABLE_NAME_REGEX,
  templateMetaSchema,
} from "../templates/template.schema";

import { MODPACK_VARIABLES, gameModsSchema, gameModpackRefSchema } from "./mods.schema";

/**
 * Game server definitions ("game.json").
 *
 * A game is a directory under `games/` in the template catalogue holding
 * `game.json` (this schema) and an optional logo. Unlike a Compose blueprint it
 * describes exactly one container, and it is *configurable*: `variables` are
 * fields the user fills in at creation time (max players, version, world
 * seed…), rendered as a form from this definition.
 *
 * Like `template.json`, a definition never contains a secret. A secret
 * variable either comes from the user or is derived per server from its
 * `generator` (`"${password:24}"`).
 *
 * `${name}` inside `image`, `env` and `command` references a variable by key,
 * or one of the built-ins DeployKit supplies at provisioning time:
 *
 *   ${dk_server_name}   the game server's name in DeployKit
 *   ${dk_memory_mb}     the container's memory limit in MB
 *   ${dk_heap_mb}       75% of it — what a JVM heap should be capped at
 *   ${dk_port_<name>}   the host port allocated for the port named <name>
 */

const ENV_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Name of a game server inside DeployKit; also its container-name stem. */
const GAME_SERVER_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** A port / volume name: usable in `${dk_port_<name>}` and in volume names. */
const GAME_SLUG_REGEX = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Generators a game may use for a blank field. `domain`, `email` and `jwt`
 * make no sense for a game server and are refused.
 */
const GAME_GENERATOR_REGEX =
  /^\$\{(password|base64|hash|uuid|randomPort|username|timestamp)(?::\d+)?\}$/;

const BUILTIN_VARIABLES = ["dk_server_name", "dk_memory_mb", "dk_heap_mb"] as const;
const PORT_VARIABLE_PREFIX = "dk_port_";

/**
 * The DeployKit game image contract (`CONTRACT.md` in
 * `deploykithq/deploykit-game-images`). A definition with `"contract": 1`
 * targets an image that follows it, and DeployKit then supplies the inputs
 * itself: `DK_VAR_<KEY>` for every variable, `DK_PORT_<NAME>` for every port,
 * `DK_SERVER_NAME`, `DK_MEMORY_MB`, `DK_HEAP_MB` and `DK_STOP_TIMEOUT`. The
 * image owns the console (always its stdin), readiness and the clean stop.
 */
const GAME_CONTRACT_VERSION = 1;
/** The line every contract image prints once the game accepts players. */
const CONTRACT_READY_PATTERN = "\\[deploykit\\] ready";
const CONTRACT_DATA_PATH = "/data";
const CONTRACT_SERVER_PATH = "/server";
/**
 * Docker's stop timeout minus the one handed to the image: after its own
 * timeout the supervisor still sends SIGTERM and, 5 s later, SIGKILL.
 */
const CONTRACT_STOP_MARGIN_SEC = 10;
/** The env vars a contract image reads each mod source from. */
const CONTRACT_MOD_ENV = {
  modrinth: { env: "DK_MODS_MODRINTH" },
  curseforge: { env: "DK_MODS_CURSEFORGE", apiKeyEnv: "DK_CURSEFORGE_API_KEY" },
  "steam-workshop": { env: "DK_MODS_STEAM", enabledEnv: "DK_MODS_STEAM_ENABLED" },
} as const;
const CONTRACT_MODPACK_ENV = ["DK_MODPACK_SOURCE", "DK_MODPACK_PROJECT", "DK_MODPACK_VERSION"];
/** The only `DK_*` a contract definition sets itself; DeployKit injects the rest. */
const CONTRACT_ENV_ALLOWED = ["DK_GAME_VERSION"];
/** Contract variable keys become `DK_VAR_<KEY>`: lower case keeps that 1:1. */
const CONTRACT_VARIABLE_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

/** `world_name` → `DK_VAR_WORLD_NAME`. */
const contractVarEnv = (key: string) => `DK_VAR_${key.toUpperCase()}`;
/** `game` → `DK_PORT_GAME`. */
const contractPortEnv = (name: string) => `DK_PORT_${name.toUpperCase()}`;

const gameMetaSchema = templateMetaSchema.extend({
  category: z.string().min(1).max(30).optional(),
  players: z
    .object({ min: z.number().int().min(1), max: z.number().int().min(1) })
    .optional(),
});

const gamePortSchema = z.object({
  name: z.string().regex(GAME_SLUG_REGEX, "Invalid port name"),
  protocol: z.enum(["tcp", "udp"]),
  /** Port the server listens on inside the container. */
  container: z.number().int().min(1).max(65535),
  /** Host port suggested by default. Falls back to `container`. */
  defaultHost: z.number().int().min(1).max(65535).optional(),
  /**
   * The container must listen on the *same* number as the host port — for
   * games that advertise their own port (Steam). The allocated host port then
   * replaces `container`, and the server is told about it through `env`.
   */
  matchHost: z.boolean().default(false),
  /** Env var that receives the allocated host port. */
  env: z.string().regex(ENV_KEY_REGEX).max(256).optional(),
  /**
   * Keep this port at a fixed distance from another (Valheim: query = game+1).
   * The port named here is allocated first and this one follows it.
   */
  offsetOf: z.string().regex(GAME_SLUG_REGEX).optional(),
  offset: z.number().int().min(-100).max(100).optional(),
  description: z.string().max(200).optional(),
});

const gameVariableSchema = z
  .object({
    key: z.string().min(1).max(64).regex(VARIABLE_NAME_REGEX, "Invalid variable key"),
    label: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    type: z.enum(["string", "number", "boolean", "select"]),
    default: z.union([z.string().max(2_000), z.number(), z.boolean()]).optional(),
    /** A required boolean must be *true* (accepting a EULA). */
    required: z.boolean().default(false),
    /** false = fixed once the server exists (a world seed, a world name). */
    editable: z.boolean().default(true),
    /** Stored encrypted; shown only to callers who may view secrets. */
    secret: z.boolean().default(false),
    /** Fills the field when it is left blank, e.g. "${password:24}". */
    generator: z
      .string()
      .regex(GAME_GENERATOR_REGEX, "generator must be a single ${helper[:n]} call")
      .optional(),
    options: z
      .array(
        z.object({
          label: z.string().min(1).max(100),
          value: z.string().max(200),
        }),
      )
      .min(1)
      .max(50)
      .optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().max(500).optional(),
    maxLength: z.number().int().min(1).max(2_000).default(500),
    /** Form section, e.g. "Gameplay" or "Network". */
    group: z.string().min(1).max(50).optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${v.key}: ${message}` });

    if (v.type === "select") {
      if (!v.options) issue("a select needs options");
      else if (
        v.default !== undefined &&
        !v.options.some((o) => o.value === String(v.default))
      ) {
        issue("default is not one of the options");
      }
    } else if (v.options) {
      issue("only a select may declare options");
    }
    if (v.generator && v.type !== "string") issue("only a string may have a generator");
    if (v.default !== undefined) {
      const expected = v.type === "select" ? "string" : v.type;
      if (typeof v.default !== expected) issue(`default must be a ${expected}`);
    }
    if (v.pattern) {
      try {
        new RegExp(v.pattern);
      } catch {
        issue("pattern is not a valid regular expression");
      }
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
      issue("min is greater than max");
    }
  });

const gameVolumeSchema = z.object({
  name: z.string().regex(GAME_SLUG_REGEX, "Invalid volume name"),
  /** Absolute path inside the container. */
  path: z.string().regex(/^\/[A-Za-z0-9._\-/]*$/, "Volume path must be absolute"),
  primary: z.boolean().default(false),
  /** Whether the Files tab may open it. */
  browsable: z.boolean().default(true),
  /** What a world backup takes from this volume, or false to skip it. */
  backup: z
    .union([
      z.literal(false),
      z.object({
        include: z
          .array(z.string().regex(/^(\.|[A-Za-z0-9._][A-Za-z0-9._\-/]*)$/))
          .min(1)
          .max(20)
          .refine((paths) => paths.every((p) => !p.includes("..")), "No '..' in paths")
          .default(["."]),
      }),
    ])
    .default({ include: ["."] }),
});

const gameConsoleSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("rcon"),
    protocol: z.enum(["source", "minecraft"]),
    /** Container port RCON listens on. It does not need to be published. */
    port: z.number().int().min(1).max(65535),
    /** Key of the secret variable holding the RCON password. */
    passwordVar: z.string().regex(VARIABLE_NAME_REGEX),
  }),
  /** Commands are written to the server process' stdin. */
  z.object({ method: z.literal("stdin") }),
  /**
   * Each command runs as `docker exec <container> ...command "<cmd>"` — for
   * images that ship their own injector (tModLoader's `inject`).
   */
  z.object({
    method: z.literal("exec"),
    command: z.array(z.string().min(1).max(100)).min(1).max(5),
  }),
  z.object({ method: z.literal("none") }),
]);

const gameConfigFileSchema = z.object({
  volume: z.string().regex(GAME_SLUG_REGEX),
  path: z.string().min(1).max(255).regex(RELATIVE_PATH_REGEX, "Invalid config file path"),
  label: z.string().min(1).max(100),
  language: z.enum(["properties", "yaml", "json", "ini", "text"]).default("text"),
});

/** Every `${name}` (or `${name:arg}`) in a string. */
const referencesIn = (value: string): Array<{ name: string; arg?: string }> =>
  [...value.matchAll(new RegExp(TEMPLATE_VARIABLE_SOURCE, "g"))].map((m) => ({
    name: m[1]!,
    ...(m[2] !== undefined ? { arg: m[2] } : {}),
  }));

/** The full contents of a game's `game.json`. */
const gameSpecBaseSchema = gameMetaSchema
  .extend({
    /**
     * The image follows the DeployKit game image contract (version 1): see
     * `GAME_CONTRACT_VERSION`. Absent for a third-party image.
     */
    contract: z.literal(GAME_CONTRACT_VERSION).optional(),
    /** May reference select variables, e.g. "ghcr.io/deploykithq/game-minecraft-java:0.1-${java_tag}". */
    image: z.string().min(1).max(500),
    /** Overrides the image's command; `${var}` allowed in each element. */
    command: z.array(z.string().max(1_000)).max(50).optional(),
    ports: z.array(gamePortSchema).min(1).max(10),
    variables: z.array(gameVariableSchema).max(50).default([]),
    env: z
      .record(
        z.string().min(1).max(256).regex(ENV_KEY_REGEX, "Invalid env var name"),
        z.string().max(10_000),
      )
      .default({}),
    volumes: z.array(gameVolumeSchema).min(1).max(4),
    console: gameConsoleSchema.default({ method: "none" }),
    stop: z
      .object({
        signal: z.string().regex(/^SIG[A-Z0-9]+$/).optional(),
        timeoutSec: z.number().int().min(10).max(600).default(30),
        /** Console command that shuts the server down cleanly ("stop", "exit"). */
        command: z.string().min(1).max(200).optional(),
      })
      .default({}),
    /** Log line (regex) that means the server is ready for players. */
    readyPattern: z.string().max(500).optional(),
    backup: z
      .object({
        /** Console commands sent before archiving, e.g. "save-off". */
        preCommands: z.array(z.string().min(1).max(200)).max(10).default([]),
        postCommands: z.array(z.string().min(1).max(200)).max(10).default([]),
        /** Wait after `preCommands` so the server finishes flushing. */
        settleSeconds: z.number().int().min(0).max(60).default(0),
      })
      .default({}),
    /** Shortcuts the Files tab shows for the files worth editing. */
    configFiles: z.array(gameConfigFileSchema).max(20).default([]),
    resources: z
      .object({
        memoryMb: z.object({
          min: z.number().int().min(128).max(65536),
          recommended: z.number().int().min(128).max(65536),
        }),
        cpuMillicores: z
          .object({ recommended: z.number().int().min(100).max(64000) })
          .optional(),
      })
      .default({ memoryMb: { min: 512, recommended: 2048 } }),
    /** Markdown shown on the server's General tab. */
    notes: z.string().max(2_000).optional(),
    /** Where mods come from and how the image receives them. */
    mods: gameModsSchema.optional(),
  });

const gameSpecSchema = gameSpecBaseSchema
  .superRefine((spec, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    const varKeys = new Set<string>();
    spec.variables.forEach((v, i) => {
      if (varKeys.has(v.key)) issue(["variables", i, "key"], `Duplicate variable "${v.key}"`);
      if (v.key.startsWith("dk_")) issue(["variables", i, "key"], `"dk_" is reserved`);
      varKeys.add(v.key);
    });

    const portNames = new Set<string>();
    const portPairs = new Set<string>();
    spec.ports.forEach((p, i) => {
      if (portNames.has(p.name)) issue(["ports", i, "name"], `Duplicate port "${p.name}"`);
      portNames.add(p.name);
      const pair = `${p.container}/${p.protocol}`;
      if (portPairs.has(pair)) issue(["ports", i], `Duplicate port ${pair}`);
      portPairs.add(pair);
    });
    spec.ports.forEach((p, i) => {
      if ((p.offsetOf === undefined) !== (p.offset === undefined)) {
        issue(["ports", i], "offsetOf and offset go together");
      }
      if (p.offsetOf !== undefined) {
        const base = spec.ports.find((q) => q.name === p.offsetOf);
        if (!base || base.name === p.name) {
          issue(["ports", i, "offsetOf"], `Unknown port "${p.offsetOf}"`);
        } else if (base.offsetOf !== undefined) {
          issue(["ports", i, "offsetOf"], "An offset port cannot follow another offset port");
        }
      }
    });

    const known = new Set<string>([
      ...varKeys,
      ...BUILTIN_VARIABLES,
      ...[...portNames].map((n) => `${PORT_VARIABLE_PREFIX}${n}`),
    ]);
    const checkRefs = (path: (string | number)[], value: string) => {
      for (const ref of referencesIn(value)) {
        if (ref.arg !== undefined) {
          issue(path, `\${${ref.name}:${ref.arg}} — helpers belong in a variable's "generator"`);
        } else if (!known.has(ref.name)) {
          issue(path, `\${${ref.name}} is not a declared variable or built-in`);
        }
      }
    };
    checkRefs(["image"], spec.image);
    for (const [key, value] of Object.entries(spec.env)) checkRefs(["env", key], value);
    spec.command?.forEach((c, i) => checkRefs(["command", i], c));

    const volumeNames = new Set<string>();
    spec.volumes.forEach((v, i) => {
      if (volumeNames.has(v.name)) issue(["volumes", i, "name"], `Duplicate volume "${v.name}"`);
      volumeNames.add(v.name);
    });
    if (spec.volumes.filter((v) => v.primary).length !== 1) {
      issue(["volumes"], "Exactly one volume must be primary");
    }
    spec.configFiles.forEach((f, i) => {
      if (!volumeNames.has(f.volume)) {
        issue(["configFiles", i, "volume"], `Unknown volume "${f.volume}"`);
      }
    });

    if (spec.console.method === "rcon") {
      const pw = spec.variables.find((v) => v.key === (spec.console as any).passwordVar);
      if (!pw) issue(["console", "passwordVar"], "passwordVar is not a declared variable");
      else if (!pw.secret) issue(["console", "passwordVar"], "passwordVar must be a secret variable");
    }
    const needsConsole =
      spec.backup.preCommands.length > 0 ||
      spec.backup.postCommands.length > 0 ||
      spec.stop.command !== undefined;
    if (needsConsole && spec.console.method === "none") {
      issue(["console"], "backup commands and stop.command need a console");
    }
    if (spec.resources.memoryMb.min > spec.resources.memoryMb.recommended) {
      issue(["resources", "memoryMb"], "min is greater than recommended");
    }
    if (spec.readyPattern) {
      try {
        new RegExp(spec.readyPattern);
      } catch {
        issue(["readyPattern"], "Not a valid regular expression");
      }
    }

    if (spec.mods) {
      const mods = spec.mods;
      const seen = new Set<string>();
      const modEnvNames = new Set<string>();
      mods.sources.forEach((s, i) => {
        if (seen.has(s.source)) issue(["mods", "sources", i], `Duplicate source "${s.source}"`);
        seen.add(s.source);
        const isSteam = s.source === "steam-workshop";
        if (isSteam && s.appId === undefined) {
          issue(["mods", "sources", i, "appId"], "steam-workshop needs appId");
        }
        if (!isSteam && (s.appId !== undefined || s.enabledEnv !== undefined)) {
          issue(["mods", "sources", i], "appId and enabledEnv are for steam-workshop only");
        }
        if (s.apiKeyEnv !== undefined && s.source !== "curseforge") {
          issue(["mods", "sources", i, "apiKeyEnv"], "apiKeyEnv is for curseforge only");
        }
        for (const name of [s.env, s.enabledEnv, s.apiKeyEnv]) {
          if (name === undefined) continue;
          if (name in spec.env) issue(["mods", "sources", i], `${name} is already set in env`);
          if (modEnvNames.has(name)) issue(["mods", "sources", i], `${name} is used twice`);
          modEnvNames.add(name);
        }
      });

      if (mods.loader) {
        const loader = mods.loader;
        const select = spec.variables.find((v) => v.key === loader.from);
        if (!select || select.type !== "select") {
          issue(["mods", "loader", "from"], "loader.from must be a select variable");
        } else {
          for (const value of Object.keys(loader.map)) {
            if (!select.options!.some((o) => o.value === value)) {
              issue(["mods", "loader", "map", value], `"${value}" is not an option of ${select.key}`);
            }
          }
        }
      }
      if (mods.gameVersion && !varKeys.has(mods.gameVersion.from)) {
        issue(["mods", "gameVersion", "from"], "gameVersion.from is not a declared variable");
      }

      // Only the modpack built-ins: this env is rendered apart from the rest.
      const packKnown = new Set<string>(MODPACK_VARIABLES);
      const packSources = new Set<string>();
      mods.modpacks.forEach((p, i) => {
        if (!seen.has(p.source)) {
          issue(["mods", "modpacks", i, "source"], `"${p.source}" is not in sources`);
        }
        if (p.source === "steam-workshop") {
          issue(["mods", "modpacks", i, "source"], "The Workshop has no modpacks");
        }
        if (packSources.has(p.source)) {
          issue(["mods", "modpacks", i], `Duplicate modpack source "${p.source}"`);
        }
        packSources.add(p.source);
        for (const [key, value] of Object.entries(p.env)) {
          for (const ref of referencesIn(value)) {
            if (ref.arg !== undefined || !packKnown.has(ref.name)) {
              issue(["mods", "modpacks", i, "env", key], `\${${ref.name}} is not available here`);
            }
          }
        }
      });

      mods.directories.forEach((d, i) => {
        if (!volumeNames.has(d.volume)) {
          issue(["mods", "directories", i, "volume"], `Unknown volume "${d.volume}"`);
        }
      });
    }

    if (spec.contract !== undefined) checkContract(spec, issue);
  });

/**
 * What a contract image takes for granted. DeployKit injects the `DK_*`
 * inputs and the image does the rest, so a definition may not redo either
 * half: no console but stdin, no stop command or signal of its own, the
 * contract's ready line, `/data` and `/server`, the contract's mod vars.
 */
function checkContract(
  spec: z.infer<typeof gameSpecBaseSchema>,
  issue: (path: (string | number)[], message: string) => void,
): void {
  spec.variables.forEach((v, i) => {
    if (!CONTRACT_VARIABLE_KEY_REGEX.test(v.key)) {
      issue(["variables", i, "key"], "Contract variable keys are lower case (they become DK_VAR_<KEY>)");
    }
  });
  if (spec.command) issue(["command"], "A contract image starts itself: no command");
  if (spec.console.method !== "stdin") {
    issue(["console"], 'A contract image takes its console on stdin: { "method": "stdin" }');
  }
  if (spec.stop.command !== undefined || spec.stop.signal !== undefined) {
    issue(["stop"], "A contract image stops the game itself on SIGTERM: set only timeoutSec");
  }
  if (spec.stop.timeoutSec < CONTRACT_STOP_MARGIN_SEC + 10) {
    issue(["stop", "timeoutSec"], `At least ${CONTRACT_STOP_MARGIN_SEC + 10} seconds for a contract image`);
  }
  if (spec.readyPattern !== undefined && spec.readyPattern !== CONTRACT_READY_PATTERN) {
    issue(["readyPattern"], `A contract image signals readiness with ${CONTRACT_READY_PATTERN}`);
  }

  spec.volumes.forEach((v, i) => {
    if (v.primary) {
      if (v.path !== CONTRACT_DATA_PATH) {
        issue(["volumes", i, "path"], `The primary volume of a contract image is ${CONTRACT_DATA_PATH}`);
      }
    } else if (v.path !== CONTRACT_SERVER_PATH) {
      issue(["volumes", i, "path"], `A contract image has ${CONTRACT_DATA_PATH} and ${CONTRACT_SERVER_PATH} only`);
    } else if (v.backup !== false) {
      issue(["volumes", i, "backup"], `${CONTRACT_SERVER_PATH} holds re-downloadable game files: backup false`);
    }
  });

  for (const key of Object.keys(spec.env)) {
    if (key.startsWith("DK_") && !CONTRACT_ENV_ALLOWED.includes(key)) {
      issue(["env", key], `DeployKit sets the DK_* inputs of a contract image; only ${CONTRACT_ENV_ALLOWED.join(", ")} goes in env`);
    }
  }
  spec.ports.forEach((p, i) => {
    if (p.env !== undefined) {
      issue(["ports", i, "env"], `A contract image reads ${contractPortEnv(p.name)}: no env`);
    }
  });

  spec.mods?.sources.forEach((s, i) => {
    const expected: { env: string; enabledEnv?: string; apiKeyEnv?: string } =
      CONTRACT_MOD_ENV[s.source];
    for (const field of ["env", "enabledEnv", "apiKeyEnv"] as const) {
      if (s[field] !== expected[field]) {
        issue(
          ["mods", "sources", i, field],
          expected[field]
            ? `A contract image reads ${s.source} from ${expected[field]}`
            : `Not used by a contract image`,
        );
      }
    }
  });
  spec.mods?.modpacks.forEach((p, i) => {
    for (const key of Object.keys(p.env)) {
      if (!CONTRACT_MODPACK_ENV.includes(key)) {
        issue(["mods", "modpacks", i, "env", key], `A contract image reads ${CONTRACT_MODPACK_ENV.join(", ")}`);
      }
    }
    if (p.env.DK_MODPACK_SOURCE !== p.source) {
      issue(["mods", "modpacks", i, "env", "DK_MODPACK_SOURCE"], `Must be "${p.source}"`);
    }
  });
}

/** What the catalogue publishes at `games/index.json`. */
const gameIndexSchema = z.array(gameMetaSchema);

// ─── API inputs ──────────────────────────────────────────────────────────────

const gameValueSchema = z.union([z.string().max(2_000), z.number(), z.boolean()]);
const gameValuesSchema = z.record(z.string().max(64), gameValueSchema);
const gamePortOverridesSchema = z.record(
  z.string().regex(GAME_SLUG_REGEX),
  z.number().int().min(1).max(65535),
);

const createGameServerSchema = z.object({
  projectId: z.string().uuid(),
  name: z
    .string()
    .regex(
      GAME_SERVER_NAME_REGEX,
      "Lowercase letters, digits and hyphens; must start with a letter or digit",
    ),
  gameId: z.string().min(1).max(64).regex(TEMPLATE_ID_REGEX),
  values: gameValuesSchema.default({}),
  ports: gamePortOverridesSchema.optional(),
  memoryMb: z.number().int().min(256).max(65536),
  cpuMillicores: z.number().int().min(100).max(64000).optional(),
  serverId: z.string().uuid().nullable().optional(),
  /** Start from a modpack instead of the plain game (games with mods.modpacks). */
  modpack: gameModpackRefSchema.optional(),
  /**
   * false leaves the server idle, with no container: mods added before the
   * first start are there when the world is generated.
   */
  start: z.boolean().default(true),
});

const updateGameServerSchema = z.object({
  id: z.string().uuid(),
  values: gameValuesSchema.optional(),
  ports: gamePortOverridesSchema.optional(),
  memoryMb: z.number().int().min(256).max(65536).optional(),
  cpuMillicores: z.number().int().min(100).max(64000).nullable().optional(),
});

/** Retention is a number of archives, not days: worlds are large. */
const gameBackupConfigSchema = z.object({
  id: z.string().uuid(),
  backupEnabled: z.boolean(),
  backupCron: z.string().max(100).optional(),
  backupRetention: z.number().int().min(1).max(100),
});

const gameConsoleCommandSchema = z.object({
  id: z.string().uuid(),
  command: z
    .string()
    .min(1)
    .max(1_000)
    // One call is one command: a newline would smuggle in a second one.
    .refine((c) => !/[\r\n\0]/.test(c), "A command cannot contain line breaks"),
});

// ─── Value validation (shared by the form and the API) ───────────────────────

type GameValueT = z.infer<typeof gameValueSchema>;
type GameSpecT = z.infer<typeof gameSpecSchema>;
type GameVariableT = z.infer<typeof gameVariableSchema>;

interface GameValuesResultI {
  /** Normalised to strings, ready to substitute into env. */
  values: Record<string, string>;
  /** Blank fields the API must fill from their generator. */
  toGenerate: string[];
  /** Field key → message. Empty when valid. */
  errors: Record<string, string>;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

const normaliseValue = (
  v: GameVariableT,
  raw: GameValueT,
): { value?: string; error?: string } => {
  switch (v.type) {
    case "boolean": {
      const b = raw === true || raw === "true" ? true : raw === false || raw === "false" ? false : null;
      if (b === null) return { error: "Must be true or false" };
      if (v.required && !b) return { error: `${v.label} must be accepted` };
      return { value: String(b) };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return { error: "Must be a number" };
      if (v.min !== undefined && n < v.min) return { error: `Must be at least ${v.min}` };
      if (v.max !== undefined && n > v.max) return { error: `Must be at most ${v.max}` };
      return { value: String(n) };
    }
    case "select": {
      const s = String(raw);
      if (!v.options?.some((o) => o.value === s)) return { error: "Not one of the options" };
      return { value: s };
    }
    default: {
      const s = String(raw);
      if (s.length > v.maxLength) return { error: `At most ${v.maxLength} characters` };
      if (/[\r\n\0]/.test(s)) return { error: "Cannot contain line breaks" };
      if (v.pattern && !new RegExp(v.pattern).test(s)) return { error: "Invalid format" };
      return { value: s };
    }
  }
};

/**
 * Validate the values a user entered against a game's variables.
 *
 * - `create`: missing fields take their default; a blank field with a
 *   generator is listed in `toGenerate`; a required field with neither is an
 *   error.
 * - `update`: only the keys present are validated; changing a non-editable key
 *   is an error (resending its `current` value is not), and a blank secret
 *   means "keep the current value" (it is dropped).
 */
const validateGameValues = (
  spec: Pick<GameSpecT, "variables">,
  input: Record<string, GameValueT | null | undefined>,
  mode: "create" | "update",
  current: Record<string, string> = {},
): GameValuesResultI => {
  const values: Record<string, string> = {};
  const toGenerate: string[] = [];
  const errors: Record<string, string> = {};
  const byKey = new Map(spec.variables.map((v) => [v.key, v]));

  for (const key of Object.keys(input)) {
    if (!byKey.has(key)) errors[key] = "Unknown setting";
  }

  for (const v of spec.variables) {
    const present = Object.prototype.hasOwnProperty.call(input, v.key);
    let raw = input[v.key];

    if (mode === "update") {
      if (!present) continue;
      if (!v.editable) {
        if (!isBlank(raw) && String(raw) !== current[v.key]) {
          errors[v.key] = `${v.label} cannot be changed after creation`;
        }
        continue;
      }
      if (v.secret && isBlank(raw)) continue;
    }

    if (isBlank(raw) && mode === "create" && v.default !== undefined) raw = v.default;

    if (isBlank(raw)) {
      if (mode === "create" && v.generator) {
        toGenerate.push(v.key);
      } else if (v.required) {
        errors[v.key] = `${v.label} is required`;
      } else {
        values[v.key] = "";
      }
      continue;
    }

    const result = normaliseValue(v, raw as GameValueT);
    if (result.error) errors[v.key] = result.error;
    else values[v.key] = result.value!;
  }

  return { values, toGenerate, errors };
};

type GameMetaT = z.infer<typeof gameMetaSchema>;
type GamePortT = z.infer<typeof gamePortSchema>;
type GameVolumeT = z.infer<typeof gameVolumeSchema>;
type GameConsoleT = z.infer<typeof gameConsoleSchema>;
type GameConfigFileT = z.infer<typeof gameConfigFileSchema>;
type CreateGameServerInputT = z.infer<typeof createGameServerSchema>;
type UpdateGameServerInputT = z.infer<typeof updateGameServerSchema>;

export {
  GAME_SERVER_NAME_REGEX,
  GAME_SLUG_REGEX,
  BUILTIN_VARIABLES,
  PORT_VARIABLE_PREFIX,
  GAME_CONTRACT_VERSION,
  CONTRACT_READY_PATTERN,
  CONTRACT_DATA_PATH,
  CONTRACT_SERVER_PATH,
  CONTRACT_STOP_MARGIN_SEC,
  CONTRACT_MOD_ENV,
  contractVarEnv,
  contractPortEnv,
  gameMetaSchema,
  gamePortSchema,
  gameVariableSchema,
  gameVolumeSchema,
  gameConsoleSchema,
  gameConfigFileSchema,
  gameSpecSchema,
  gameIndexSchema,
  createGameServerSchema,
  updateGameServerSchema,
  gameBackupConfigSchema,
  gameConsoleCommandSchema,
  validateGameValues,
  type GameMetaT,
  type GamePortT,
  type GameVariableT,
  type GameVolumeT,
  type GameConsoleT,
  type GameConfigFileT,
  type GameSpecT,
  type GameValueT,
  type GameValuesResultI,
  type CreateGameServerInputT,
  type UpdateGameServerInputT,
};
