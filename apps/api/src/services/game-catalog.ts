import {
  gameIndexSchema,
  gameSpecSchema,
  type GameMetaT,
  type GameSpecT,
} from "@deploykit/shared";

import {
  cachedRegistryRead,
  clearRegistryCache,
  fetchText,
  registryUrl,
  type CatalogSourceT,
} from "./registry-cache";

/**
 * The game server catalogue.
 *
 * Game definitions live next to the Compose blueprints in the template
 * registry, under `games/`: `games/index.json` lists them, and
 * `games/<id>/game.json` is one definition. They share the registry's
 * stale-while-error cache, so an outage keeps serving the last copy that
 * validated, and publishing a game is a commit there, not a DeployKit release.
 */

const INDEX_CACHE_KEY = "games:index";
const definitionCacheKey = (id: string) => `games:def:${id}`;

type GameCatalogEntryT = GameMetaT & { logoUrl?: string };

interface GameCatalogListI {
  games: GameCatalogEntryT[];
  source: CatalogSourceT;
  error?: string;
  cachedAt?: string;
}

const logoUrl = (id: string, logo?: string): string | undefined =>
  logo ? `${registryUrl()}/games/${id}/${logo}` : undefined;

const withLogoUrls = (games: GameMetaT[]): GameCatalogEntryT[] =>
  games.map((meta) =>
    meta.logo ? { ...meta, logoUrl: logoUrl(meta.id, meta.logo) } : meta,
  );

/** The catalogue index. Never throws. */
const listGames = async (): Promise<GameCatalogListI> => {
  const read = await cachedRegistryRead({
    key: INDEX_CACHE_KEY,
    parse: (v) => gameIndexSchema.parse(v),
    load: async () =>
      gameIndexSchema.parse(
        JSON.parse(await fetchText(`${registryUrl()}/games/index.json`)),
      ),
  });

  if (read.source === "stale") {
    console.warn(
      `[games] Registry unreachable (${read.error}); serving the cached catalogue from ${read.cachedAt}`,
    );
  } else if (read.source === "unavailable") {
    console.warn(
      `[games] Registry unreachable (${read.error}) and nothing is cached; the catalogue is empty`,
    );
  }

  return {
    games: withLogoUrls(read.value ?? []),
    source: read.source,
    ...(read.error ? { error: read.error } : {}),
    ...(read.cachedAt ? { cachedAt: read.cachedAt } : {}),
  };
};

/**
 * One game definition in full.
 *
 * @returns the definition, or null when the registry cannot serve it and no
 *          cached copy is left.
 */
const getGame = async (id: string): Promise<GameSpecT | null> => {
  const read = await cachedRegistryRead({
    key: definitionCacheKey(id),
    parse: (v) => gameSpecSchema.parse(v),
    load: async () => {
      const body = await fetchText(
        `${registryUrl()}/games/${encodeURIComponent(id)}/game.json`,
      );
      const spec = gameSpecSchema.parse(JSON.parse(body));
      if (spec.id !== id) {
        // Running something whose id differs from the one that was asked for
        // is a supply-chain problem, not a typo.
        throw new Error(`Game at /games/${id} declares id "${spec.id}"`);
      }
      return spec;
    },
  });

  if (read.source === "stale") {
    console.warn(
      `[games] Could not refresh "${id}" (${read.error}); using the cached copy`,
    );
  } else if (read.source === "unavailable") {
    console.warn(`[games] Cannot serve "${id}": ${read.error}`);
  }
  return read.value;
};

/** Drop every cached game entry so the next read re-fetches. */
const refreshGameCatalog = (): Promise<{ cleared: number }> =>
  clearRegistryCache("games:");

export {
  listGames,
  getGame,
  refreshGameCatalog,
  logoUrl as gameLogoUrl,
  type GameCatalogEntryT,
  type GameCatalogListI,
};
