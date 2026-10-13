import { substitute } from "./template-variables";

import type { GameModsSpecT, GameSpecT, ModSourceIdT } from "@deploykit/shared";
import type { GameModpackI } from "../db/schema/index";

/**
 * Turning a server's mod list into the env vars its image reads. Pure: no
 * database, no network — `services/game-mods.ts` gathers the inputs.
 *
 * Every declared source var is always emitted, even empty: the images delete
 * the mods they installed when they leave the list, and an empty list is how
 * the last one goes.
 */

interface ModEntryI {
  source: ModSourceIdT;
  projectId: string;
  versionId: string | null;
  enabled: boolean;
}

interface RenderedModEnvI {
  env: Record<string, string>;
  /** Keys of `env` holding a secret (an API key): never persisted. */
  secretKeys: string[];
}

interface CompatI {
  loaders: string[] | null;
  kind: "mod" | "plugin" | null;
  gameVersion: string | null;
  /** The version setting is an alias (LATEST) to resolve against the catalogue. */
  versionAlias: "release" | "any" | null;
  /** Why mods cannot be added with the current settings, or null. */
  unsupported: string | null;
}

const entryValue = (e: ModEntryI): string =>
  e.source === "steam-workshop" || !e.versionId ? e.projectId : `${e.projectId}:${e.versionId}`;

const renderModEnv = (
  mods: GameModsSpecT | undefined,
  entries: ModEntryI[],
  modpack: GameModpackI | null,
  keys: { curseforge: string | null },
): RenderedModEnvI => {
  const env: Record<string, string> = {};
  const secretKeys: string[] = [];
  if (!mods) return { env, secretKeys };

  for (const source of mods.sources) {
    const mine = entries.filter((e) => e.source === source.source);
    if (source.enabledEnv) {
      // Workshop: keep disabled items downloaded so re-enabling is instant.
      env[source.env] = mine.map(entryValue).join(",");
      env[source.enabledEnv] = mine.filter((e) => e.enabled).map(entryValue).join(",");
    } else {
      env[source.env] = mine.filter((e) => e.enabled).map(entryValue).join(",");
    }
    if (source.apiKeyEnv && keys.curseforge) {
      env[source.apiKeyEnv] = keys.curseforge;
      secretKeys.push(source.apiKeyEnv);
    }
  }

  const pack = modpack && mods.modpacks.find((p) => p.source === modpack.source);
  if (pack && modpack) {
    const values = {
      dk_modpack_project: modpack.projectId,
      dk_modpack_slug: modpack.slug ?? modpack.projectId,
      dk_modpack_version: modpack.versionId,
      dk_modpack_game_version: modpack.gameVersion ?? "",
      dk_modpack_loader: modpack.loader ?? "",
    };
    for (const [key, value] of Object.entries(pack.env)) env[key] = substitute(value, values);
  }

  return { env, secretKeys };
};

/** What is safe to store: the env without API keys. */
const snapshotModEnv = (r: RenderedModEnvI): Record<string, string> =>
  Object.fromEntries(Object.entries(r.env).filter(([k]) => !r.secretKeys.includes(k)));

const nonEmpty = (env: Record<string, string>) =>
  JSON.stringify(
    Object.entries(env)
      .filter(([, v]) => v !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** Whether the list differs from what the container was last built with. */
const modEnvPending = (r: RenderedModEnvI, applied: Record<string, string> | null): boolean =>
  nonEmpty(snapshotModEnv(r)) !== nonEmpty(applied ?? {});

const projectsOf = (value: string | undefined) =>
  new Set(
    (value ?? "")
      .split(",")
      .filter(Boolean)
      .map((v) => v.split(":")[0]!),
  );

/**
 * Whether applying `next` over `applied` takes something away — a mod
 * removed or disabled, or a different modpack. Worlds can depend on mod
 * content, so such a change always gets a safety backup first.
 */
const isDestructiveChange = (
  applied: Record<string, string> | null,
  next: Record<string, string>,
  mods: GameModsSpecT | undefined,
): boolean => {
  if (!applied || !mods) return false;
  const listVars = mods.sources.flatMap((s) => [s.env, ...(s.enabledEnv ? [s.enabledEnv] : [])]);
  for (const name of listVars) {
    const after = projectsOf(next[name]);
    for (const project of projectsOf(applied[name])) if (!after.has(project)) return true;
  }
  const packVars = new Set(mods.modpacks.flatMap((p) => Object.keys(p.env)));
  for (const name of packVars) {
    const before = applied[name] ?? "";
    if (before !== "" && before !== (next[name] ?? "")) return true;
  }
  return false;
};

/** The backup that was queued ahead of an apply, as the worker finds it. */
interface SafetyBackupI {
  status: string;
  error: string | null;
}

/** A failed backup that only means there was no world yet: nothing to lose. */
const NOTHING_TO_BACK_UP = /^Nothing to back up yet/;

/**
 * The worker's last word before rebuilding a server with a new mod list.
 * The list is rendered when the job runs, not when it was queued, so a
 * change can have become destructive in between; and the backup queued
 * ahead of it may have failed. Either way a destructive change needs a
 * safety backup that succeeded.
 */
const mayApplyMods = (
  applied: Record<string, string> | null,
  next: Record<string, string>,
  mods: GameModsSpecT | undefined,
  backup: SafetyBackupI | null,
): { ok: true } | { ok: false; reason: string } => {
  if (!isDestructiveChange(applied, next, mods)) return { ok: true };
  if (!backup) {
    return {
      ok: false,
      reason: "The pending changes now remove mods or change the modpack. Apply them again so a safety backup runs first.",
    };
  }
  if (backup.status === "success" || NOTHING_TO_BACK_UP.test(backup.error ?? "")) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `The safety backup failed, so the mod changes were not applied: ${backup.error ?? "unknown error"}`,
  };
};

/**
 * The mod env to build a container with. Only applying mods takes the current
 * list; any other rebuild (a settings change, a container that disappeared)
 * keeps what was applied last — pending changes must go through the apply
 * path and its safety backup. API keys always come from the live render, as
 * they are never stored. A server never provisioned has nothing applied yet.
 */
const modEnvForProvision = (
  rendered: RenderedModEnvI,
  applied: Record<string, string> | null,
  mode: "current" | "applied",
): Record<string, string> => {
  if (mode === "current" || !applied) return rendered.env;
  const keys = Object.fromEntries(rendered.secretKeys.map((k) => [k, rendered.env[k]!]));
  return { ...applied, ...keys };
};

/** What a server can take: from its modpack, or from its loader/version settings. */
const compatFilter = (
  spec: Pick<GameSpecT, "mods" | "variables">,
  values: Record<string, string>,
  modpack: GameModpackI | null,
): CompatI => {
  const mods = spec.mods;
  const none: CompatI = {
    loaders: null,
    kind: null,
    gameVersion: null,
    versionAlias: null,
    unsupported: null,
  };
  if (!mods) return { ...none, unsupported: "This game does not support mods" };

  if (modpack) {
    return {
      loaders: modpack.loader ? [modpack.loader] : null,
      kind: "mod",
      gameVersion: modpack.gameVersion,
      versionAlias: null,
      unsupported: null,
    };
  }

  const result = { ...none };
  if (mods.loader) {
    const loader = mods.loader;
    const mapped = loader.map[values[loader.from] ?? ""];
    if (!mapped) {
      const label = spec.variables.find((v) => v.key === loader.from)?.label ?? loader.from;
      return {
        ...none,
        unsupported: `Mods need a different ${label}: switch it to one of ${Object.keys(loader.map).join(", ")} in Settings`,
      };
    }
    result.loaders = mapped.loaders;
    result.kind = mapped.kind;
  }
  if (mods.gameVersion) {
    const raw = values[mods.gameVersion.from] ?? "";
    const alias = mods.gameVersion.aliases[raw];
    if (alias) result.versionAlias = alias;
    else if (raw) result.gameVersion = raw;
  }
  return result;
};

export {
  renderModEnv,
  snapshotModEnv,
  modEnvPending,
  isDestructiveChange,
  mayApplyMods,
  modEnvForProvision,
  compatFilter,
  type ModEntryI,
  type SafetyBackupI,
  type RenderedModEnvI,
  type CompatI,
};
