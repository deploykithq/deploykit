import { z } from "zod";

import { RELATIVE_PATH_REGEX } from "../types";
import { VARIABLE_NAME_REGEX } from "../templates/template.schema";

/**
 * Mods for game servers.
 *
 * A game declares where its mods come from and which env vars its image reads
 * them from; DeployKit keeps the list and renders it into those vars at
 * provisioning. The image does the downloading; a contract image reads the
 * `DK_MODS_*` vars (`CONTRACT_MOD_ENV`).
 */

const MOD_SOURCES = ["modrinth", "curseforge", "steam-workshop"] as const;
const modSourceIdSchema = z.enum(MOD_SOURCES);

/** Built-ins available only inside `mods.modpacks[].env`. */
const MODPACK_VARIABLES = [
  "dk_modpack_project",
  "dk_modpack_slug",
  "dk_modpack_version",
  "dk_modpack_game_version",
  "dk_modpack_loader",
] as const;

const ENV_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SLUG_REGEX = /^[a-z][a-z0-9_]{0,31}$/;
const envKey = z.string().min(1).max(256).regex(ENV_KEY_REGEX, "Invalid env var name");

const gameModSourceSchema = z.object({
  source: modSourceIdSchema,
  /** Env var that receives the comma-separated list. */
  env: envKey,
  /** Steam only: env var that receives the *enabled* subset. */
  enabledEnv: envKey.optional(),
  /** CurseForge only: env var that receives the instance API key. */
  apiKeyEnv: envKey.optional(),
  /** Steam only: the Workshop app id (tModLoader = 1281930). */
  appId: z.number().int().positive().optional(),
});

const gameModsSchema = z.object({
  sources: z.array(gameModSourceSchema).min(1).max(3),
  /** Which loader (and so which kind of content) a server runs, from a select. */
  loader: z
    .object({
      from: z.string().regex(VARIABLE_NAME_REGEX),
      map: z.record(
        z.string().max(200),
        z.object({
          loaders: z.array(z.string().regex(/^[a-z0-9-]{1,30}$/)).min(1).max(5),
          kind: z.enum(["mod", "plugin"]),
        }),
      ),
    })
    .optional(),
  /** Which game version to filter by; aliases resolve to the newest release/any. */
  gameVersion: z
    .object({
      from: z.string().regex(VARIABLE_NAME_REGEX),
      aliases: z.record(z.string().max(32), z.enum(["release", "any"])).default({}),
    })
    .optional(),
  modpacks: z
    .array(
      z.object({
        source: modSourceIdSchema,
        env: z.record(envKey, z.string().max(1_000)),
      }),
    )
    .max(3)
    .default([]),
  /** Folders whose files the Mods tab lists as "on disk". */
  directories: z
    .array(
      z.object({
        volume: z.string().regex(SLUG_REGEX),
        path: z.string().min(1).max(255).regex(RELATIVE_PATH_REGEX),
      }),
    )
    .max(5)
    .default([]),
});

// ─── API inputs ──────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
/** A project id, slug or pasted URL; parsed by the source adapter. */
const modRef = z.string().trim().min(1).max(500);
const versionId = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/);
const modKind = z.enum(["mod", "plugin", "modpack"]);

const gameModSearchSchema = z.object({
  id: uuid,
  source: modSourceIdSchema,
  query: z.string().max(100).default(""),
  kind: modKind.optional(),
  offset: z.number().int().min(0).max(9_980).default(0),
});

/** Modpack search before a server exists (the create modal). */
const gameModSearchForGameSchema = z.object({
  gameId: z.string().min(1).max(64),
  source: modSourceIdSchema,
  query: z.string().max(100).default(""),
  offset: z.number().int().min(0).max(9_980).default(0),
});

const gameModVersionsSchema = z.object({
  /** Either a server (filtered for it) or a game (unfiltered, for modpacks). */
  id: uuid.optional(),
  gameId: z.string().min(1).max(64).optional(),
  source: modSourceIdSchema,
  projectId: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
  kind: modKind.default("mod"),
});

const addGameModSchema = z.object({
  id: uuid,
  source: modSourceIdSchema,
  ref: modRef,
  versionId: versionId.optional(),
});

const updateGameModSchema = z.object({
  id: uuid,
  modId: uuid,
  enabled: z.boolean().optional(),
  versionId: versionId.optional(),
});

const removeGameModSchema = z.object({ id: uuid, modId: uuid });

const gameModpackRefSchema = z.object({
  source: modSourceIdSchema,
  ref: modRef,
  versionId: versionId.optional(),
});

const setGameModpackSchema = z.object({
  id: uuid,
  modpack: gameModpackRefSchema.nullable(),
});

const applyGameModsSchema = z.object({
  id: uuid,
  /** Ignored (forced on) when the change removes mods or swaps the modpack. */
  safetyBackup: z.boolean().default(false),
});

const GAME_MOD_KEYS = ["curseforge_api_key", "steam_web_api_key"] as const;

const setGameModKeySchema = z.object({
  key: z.enum(GAME_MOD_KEYS),
  value: z.string().trim().min(8).max(200).nullable(),
});

type ModSourceIdT = z.infer<typeof modSourceIdSchema>;
type ModKindT = z.infer<typeof modKind>;
type GameModsSpecT = z.infer<typeof gameModsSchema>;
type GameModSourceT = z.infer<typeof gameModSourceSchema>;
type GameModpackRefT = z.infer<typeof gameModpackRefSchema>;
type GameModKeyT = (typeof GAME_MOD_KEYS)[number];

export {
  MOD_SOURCES,
  MODPACK_VARIABLES,
  GAME_MOD_KEYS,
  modSourceIdSchema,
  gameModSourceSchema,
  gameModsSchema,
  gameModSearchSchema,
  gameModSearchForGameSchema,
  gameModVersionsSchema,
  addGameModSchema,
  updateGameModSchema,
  removeGameModSchema,
  gameModpackRefSchema,
  setGameModpackSchema,
  applyGameModsSchema,
  setGameModKeySchema,
  type ModSourceIdT,
  type ModKindT,
  type GameModsSpecT,
  type GameModSourceT,
  type GameModpackRefT,
  type GameModKeyT,
};
