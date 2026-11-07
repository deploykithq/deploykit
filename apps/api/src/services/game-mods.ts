import { and, asc, eq } from "drizzle-orm";

import { db } from "../db/index";
import { gameServers, gameServerMods } from "../db/schema/index";

import { getSetting } from "./instance-settings";
import { adapterFor, contextFor, resolveVersionAlias, ModSourceError } from "./mod-sources/index";
import {
  compatFilter,
  isDestructiveChange,
  modEnvPending,
  renderModEnv,
  snapshotModEnv,
  type RenderedModEnvI,
} from "./game-mods-env";

import type { GameModpackRefT, GameSpecT, ModKindT, ModSourceIdT } from "@deploykit/shared";
import type { GameModpackI, GameServerModT, GameServerT } from "../db/schema/index";
import type {
  ModFilterI,
  ModSearchResultI,
  ModSummaryI,
  ModVersionI,
} from "./mod-sources/index";

/**
 * A game server's mods: the list DeployKit keeps, and the catalogue lookups
 * that fill it. Nothing here downloads a mod — the image does that when the
 * container is recreated with the rendered env (see game-mods-env.ts).
 *
 * Callers pass the server's current values (`allValues(row)` from
 * game-server.ts) rather than this module reading them, so it does not
 * import game-server and no cycle forms.
 */

type GameModErrorCodeT =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "SERVICE_UNAVAILABLE";

class GameModError extends Error {
  constructor(
    public code: GameModErrorCodeT,
    message: string,
  ) {
    super(message);
    this.name = "GameModError";
  }
}

type ModRowT = Pick<GameServerT, "id" | "spec" | "modpack" | "appliedModEnv">;

/** Adapter errors become the codes the router maps to tRPC. */
const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ModSourceError) {
      const code: GameModErrorCodeT =
        err.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : err.code === "BAD_REQUEST"
            ? "BAD_REQUEST"
            : err.code === "UNAUTHORIZED"
              ? "PRECONDITION_FAILED"
              : "SERVICE_UNAVAILABLE";
      throw new GameModError(code, err.message);
    }
    throw err;
  }
};

const declaredSource = (spec: Pick<GameSpecT, "mods">, source: ModSourceIdT) => {
  const declared = spec.mods?.sources.find((s) => s.source === source);
  if (!declared) throw new GameModError("BAD_REQUEST", `This game does not take mods from ${source}`);
  return declared;
};

/** What the server can take right now, with LATEST resolved to a version. */
const resolveFilter = async (
  row: ModRowT,
  values: Record<string, string>,
  kind?: ModKindT,
): Promise<ModFilterI> => {
  const compat = compatFilter(row.spec, values, row.modpack);
  if (compat.unsupported) throw new GameModError("PRECONDITION_FAILED", compat.unsupported);
  const gameVersion = compat.versionAlias
    ? await wrap(() => resolveVersionAlias(compat.versionAlias!))
    : compat.gameVersion;
  return { loaders: compat.loaders, kind: kind ?? compat.kind ?? "mod", gameVersion };
};

/** The game's sources and whether each can search / install with the keys set. */
const sourcesFor = async (spec: Pick<GameSpecT, "mods">) =>
  Promise.all(
    (spec.mods?.sources ?? []).map(async (s) => ({
      id: s.source,
      ...adapterFor(s.source).capabilities(await contextFor(s)),
      modpacks: Boolean(spec.mods?.modpacks.some((p) => p.source === s.source)),
    })),
  );

const searchMods = async (
  row: ModRowT,
  values: Record<string, string>,
  input: { source: ModSourceIdT; query: string; kind?: ModKindT; offset: number },
): Promise<ModSearchResultI> => {
  const source = declaredSource(row.spec, input.source);
  const filter = await resolveFilter(row, values, input.kind);
  const ctx = await contextFor(source);
  return wrap(() => adapterFor(input.source).search(input.query, filter, input.offset, ctx));
};

const searchModpacks = async (
  spec: Pick<GameSpecT, "mods">,
  input: { source: ModSourceIdT; query: string; offset: number },
): Promise<ModSearchResultI> => {
  const source = declaredSource(spec, input.source);
  if (!spec.mods?.modpacks.some((p) => p.source === input.source)) {
    throw new GameModError("BAD_REQUEST", `This game has no ${input.source} modpacks`);
  }
  const ctx = await contextFor(source);
  return wrap(() =>
    adapterFor(input.source).search(
      input.query,
      { loaders: null, kind: "modpack", gameVersion: null },
      input.offset,
      ctx,
    ),
  );
};

const listVersions = async (
  spec: Pick<GameSpecT, "mods">,
  sourceId: ModSourceIdT,
  projectId: string,
  filter: ModFilterI | null,
): Promise<ModVersionI[]> => {
  const source = declaredSource(spec, sourceId);
  const ctx = await contextFor(source);
  return wrap(() => adapterFor(sourceId).versions(projectId, filter, ctx));
};

/** Resolve a pasted URL / slug / id and check DeployKit can install it. */
const lookupProject = async (
  spec: Pick<GameSpecT, "mods">,
  sourceId: ModSourceIdT,
  ref: string,
): Promise<ModSummaryI> => {
  const source = declaredSource(spec, sourceId);
  const adapter = adapterFor(sourceId);
  const parsed = adapter.parseRef(ref);
  if (!parsed) throw new GameModError("BAD_REQUEST", `That is not a ${sourceId} link or id`);
  const ctx = await contextFor(source);
  const caps = adapter.capabilities(ctx);
  if (!caps.install) {
    throw new GameModError("PRECONDITION_FAILED", caps.reason ?? `${sourceId} is not available`);
  }
  const project = await wrap(() => adapter.project(parsed, ctx));
  if (!project.installable) {
    throw new GameModError("BAD_REQUEST", `${project.name}: ${project.reason}`);
  }
  return project;
};

/** The wanted version if it fits, else the newest release (or newest of any type). */
const pickVersion = (
  versions: ModVersionI[],
  wanted: string | undefined,
  name: string,
  filter: ModFilterI,
): ModVersionI => {
  if (wanted) {
    const hit = versions.find((v) => v.id === wanted);
    if (!hit) throw new GameModError("BAD_REQUEST", `That version of ${name} does not fit this server`);
    return hit;
  }
  const hit = versions.find((v) => v.type === "release") ?? versions[0];
  if (!hit) {
    const what = [filter.loaders?.[0], filter.gameVersion].filter(Boolean).join(" ");
    throw new GameModError("BAD_REQUEST", `No version of ${name} works with ${what || "this server"}`);
  }
  return hit;
};

const isUniqueViolation = (err: any) =>
  err?.code === "23505" || err?.cause?.code === "23505";

/** A whole dependency tree is looked up per add: keep a runaway one bounded. */
const MAX_REQUIRED = 25;

interface RequiredItemI {
  project: ModSummaryI;
  version: ModVersionI;
}

interface RequiredResolutionI {
  /** False when the source could not say (no key, provider down). */
  checked: boolean;
  reason?: string;
  items: RequiredItemI[];
  /** Required items that could not be added, and why. */
  skipped: Array<{ projectId: string; reason: string }>;
}

interface AddModResultI {
  mod: GameServerModT;
  required: {
    checked: boolean;
    reason?: string;
    added: GameServerModT[];
    enabled: GameServerModT[];
    skipped: Array<{ projectId: string; reason: string }>;
  };
}

/**
 * Walk what `rootId` requires, breadth-first. Nothing is fetched from a
 * pasted link: every id comes from the provider's own answer. Only sources
 * with `requires` are walked (the Workshop); for the others the image
 * resolves dependencies itself.
 */
const resolveRequired = async (
  spec: Pick<GameSpecT, "mods">,
  sourceId: ModSourceIdT,
  rootId: string,
  filter: ModFilterI,
): Promise<RequiredResolutionI> => {
  const adapter = adapterFor(sourceId);
  if (!adapter.requires) return { checked: true, items: [], skipped: [] };
  const ctx = await contextFor(declaredSource(spec, sourceId));
  const items: RequiredItemI[] = [];
  const skipped: RequiredResolutionI["skipped"] = [];
  const seen = new Set([rootId]);
  const queue = [rootId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    let children: string[] | null;
    try {
      children = await adapter.requires(id, ctx);
    } catch (err) {
      if (!(err instanceof ModSourceError)) throw err;
      // The item itself was found a moment ago: this is the key or the provider.
      if (id === rootId) return { checked: false, reason: err.message, items: [], skipped: [] };
      skipped.push({ projectId: id, reason: `its own requirements: ${err.message}` });
      continue;
    }
    if (children === null) {
      return {
        checked: false,
        reason: "Checking required items needs a Steam Web API key (Settings → Game mods)",
        items: [],
        skipped: [],
      };
    }
    for (const child of children) {
      if (seen.has(child)) continue;
      seen.add(child);
      if (items.length + skipped.length >= MAX_REQUIRED) {
        skipped.push({ projectId: child, reason: `more than ${MAX_REQUIRED} required items` });
        continue;
      }
      try {
        const project = await adapter.project(child, ctx);
        if (!project.installable) {
          skipped.push({ projectId: child, reason: `${project.name}: ${project.reason}` });
          continue;
        }
        const versions = await adapter.versions(child, filter, ctx);
        const version = versions.find((v) => v.type === "release") ?? versions[0];
        if (!version) {
          skipped.push({ projectId: child, reason: `${project.name}: no version fits this server` });
          continue;
        }
        items.push({ project, version });
        queue.push(child);
      } catch (err) {
        if (!(err instanceof ModSourceError)) throw err;
        skipped.push({ projectId: child, reason: err.message });
      }
    }
  }
  return { checked: true, items, skipped };
};

const modValues = (
  row: ModRowT,
  project: ModSummaryI,
  version: ModVersionI,
  kind: ModKindT,
  userId: string,
) => ({
  gameServerId: row.id,
  source: project.source,
  projectId: project.projectId,
  slug: project.slug,
  name: project.name.slice(0, 200),
  iconUrl: project.iconUrl?.slice(0, 1000) ?? null,
  kind: kind === "plugin" ? ("plugin" as const) : ("mod" as const),
  // The Workshop always serves the latest upload; nothing to pin.
  versionId: project.source === "steam-workshop" ? null : version.id,
  versionLabel: version.label.slice(0, 200),
  addedBy: userId,
});

/**
 * Add a mod and, for the Workshop, everything it requires: a missing one is
 * added, a disabled one is enabled (tModLoader refuses to load a mod whose
 * dependency is off). An unknown requirement never blocks the add — it is
 * reported, as is not being able to check at all.
 */
const addMod = async (
  row: ModRowT,
  values: Record<string, string>,
  input: { source: ModSourceIdT; ref: string; versionId?: string },
  userId: string,
): Promise<AddModResultI> => {
  const project = await lookupProject(row.spec, input.source, input.ref);
  if (project.kind === "modpack") {
    throw new GameModError(
      "BAD_REQUEST",
      `${project.name} is a modpack: choose it as the server's modpack instead`,
    );
  }
  const filter = await resolveFilter(row, values);
  const versions = await listVersions(row.spec, input.source, project.projectId, filter);
  const version = pickVersion(versions, input.versionId, project.name, filter);
  const required = await resolveRequired(row.spec, input.source, project.projectId, filter);

  const existing = new Map(
    (await listMods(row)).filter((m) => m.source === input.source).map((m) => [m.projectId, m]),
  );
  if (existing.has(project.projectId)) {
    throw new GameModError("CONFLICT", `${project.name} is already on this server`);
  }

  try {
    return await db.transaction(async (tx) => {
      const [mod] = await tx
        .insert(gameServerMods)
        .values(modValues(row, project, version, filter.kind, userId))
        .returning();
      const added: GameServerModT[] = [];
      const enabled: GameServerModT[] = [];
      for (const item of required.items) {
        const have = existing.get(item.project.projectId);
        if (have) {
          if (have.enabled) continue;
          const [on] = await tx
            .update(gameServerMods)
            .set({ enabled: true, updatedAt: new Date() })
            .where(eq(gameServerMods.id, have.id))
            .returning();
          enabled.push(on!);
          continue;
        }
        // A concurrent add of the same dependency is not an error.
        const [created] = await tx
          .insert(gameServerMods)
          .values(modValues(row, item.project, item.version, filter.kind, userId))
          .onConflictDoNothing()
          .returning();
        if (created) added.push(created);
      }
      return {
        mod: mod!,
        required: {
          checked: required.checked,
          ...(required.reason ? { reason: required.reason } : {}),
          added,
          enabled,
          skipped: required.skipped,
        },
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new GameModError("CONFLICT", `${project.name} is already on this server`);
    }
    throw err;
  }
};

const findMod = async (row: ModRowT, modId: string): Promise<GameServerModT> => {
  const mod = await db.query.gameServerMods.findFirst({
    where: and(eq(gameServerMods.id, modId), eq(gameServerMods.gameServerId, row.id)),
  });
  if (!mod) throw new GameModError("NOT_FOUND", "Mod not found");
  return mod;
};

const updateMod = async (
  row: ModRowT,
  values: Record<string, string>,
  modId: string,
  patch: { enabled?: boolean; versionId?: string },
): Promise<GameServerModT> => {
  const mod = await findMod(row, modId);
  const set: Partial<GameServerModT> = { updatedAt: new Date() };
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.versionId !== undefined && mod.source !== "steam-workshop") {
    const filter = await resolveFilter(row, values);
    const versions = await listVersions(row.spec, mod.source, mod.projectId, filter);
    const version = pickVersion(versions, patch.versionId, mod.name, filter);
    set.versionId = version.id;
    set.versionLabel = version.label.slice(0, 200);
  }
  const [updated] = await db
    .update(gameServerMods)
    .set(set)
    .where(eq(gameServerMods.id, mod.id))
    .returning();
  return updated!;
};

const removeMod = async (row: ModRowT, modId: string): Promise<GameServerModT> => {
  const mod = await findMod(row, modId);
  await db.delete(gameServerMods).where(eq(gameServerMods.id, mod.id));
  return mod;
};

const listMods = (row: Pick<GameServerT, "id">) =>
  db.query.gameServerMods.findMany({
    where: eq(gameServerMods.gameServerId, row.id),
    orderBy: [asc(gameServerMods.name)],
  });

/** Newest compatible version per pinned mod, where it differs from the pin. */
const checkUpdates = async (row: ModRowT, values: Record<string, string>) => {
  const filter = await resolveFilter(row, values);
  const mods = await listMods(row);
  const updates: Array<{ modId: string; versionId: string; label: string }> = [];
  for (const mod of mods) {
    if (mod.source === "steam-workshop") continue;
    const versions = await listVersions(row.spec, mod.source, mod.projectId, filter).catch(
      () => [] as ModVersionI[],
    );
    const newest = versions.find((v) => v.type === "release") ?? versions[0];
    if (newest && newest.id !== mod.versionId) {
      updates.push({ modId: mod.id, versionId: newest.id, label: newest.label });
    }
  }
  return updates;
};

const modpackFromVersion = (
  project: Pick<ModSummaryI, "source" | "projectId" | "slug" | "name" | "iconUrl">,
  version: ModVersionI,
): GameModpackI => ({
  source: project.source,
  projectId: project.projectId,
  slug: project.slug,
  name: project.name.slice(0, 200),
  iconUrl: project.iconUrl,
  versionId: version.id,
  versionLabel: version.label.slice(0, 200),
  gameVersion: version.gameVersions[0] ?? null,
  loader: version.loaders.find((l) => l !== "minecraft") ?? null,
});

const resolveModpack = async (
  spec: Pick<GameSpecT, "mods">,
  ref: GameModpackRefT,
): Promise<GameModpackI> => {
  if (!spec.mods?.modpacks.some((p) => p.source === ref.source)) {
    throw new GameModError("BAD_REQUEST", `This game has no ${ref.source} modpacks`);
  }
  const project = await lookupProject(spec, ref.source, ref.ref);
  if (project.kind !== "modpack") {
    throw new GameModError("BAD_REQUEST", `${project.name} is not a modpack`);
  }
  const versions = await listVersions(spec, ref.source, project.projectId, null);
  const version = pickVersion(versions, ref.versionId, project.name, {
    loaders: null,
    kind: "modpack",
    gameVersion: null,
  });
  return modpackFromVersion(project, version);
};

const setModpack = async (row: ModRowT, pack: GameModpackI | null): Promise<void> => {
  await db
    .update(gameServers)
    .set({ modpack: pack, updatedAt: new Date() })
    .where(eq(gameServers.id, row.id));
};

/** The env the container should be built with now (keys included). */
const loadModEnv = async (row: ModRowT): Promise<RenderedModEnvI> => {
  if (!row.spec.mods) return { env: {}, secretKeys: [] };
  const mods = await listMods(row);
  const curseforge = row.spec.mods.sources.some((s) => s.apiKeyEnv)
    ? await getSetting("curseforge_api_key")
    : null;
  return renderModEnv(row.spec.mods, mods, row.modpack, { curseforge });
};

const modsPending = async (row: ModRowT) => {
  const rendered = await loadModEnv(row);
  return {
    pending: modEnvPending(rendered, row.appliedModEnv),
    destructive: isDestructiveChange(row.appliedModEnv, snapshotModEnv(rendered), row.spec.mods),
  };
};

export {
  GameModError,
  resolveFilter,
  sourcesFor,
  searchMods,
  searchModpacks,
  listVersions,
  addMod,
  resolveRequired,
  updateMod,
  removeMod,
  listMods,
  checkUpdates,
  modpackFromVersion,
  resolveModpack,
  setModpack,
  loadModEnv,
  modsPending,
  type ModRowT,
  type AddModResultI,
};
