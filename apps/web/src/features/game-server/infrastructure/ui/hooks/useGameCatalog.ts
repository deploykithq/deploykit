import { useMemo, useState } from "react";

import { trpc } from "@lib/trpc";

import type { GameCatalogEntryT } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * The game catalogue with a client-side search, like the Templates page: the
 * whole list arrives in one request, so filtering locally saves round trips.
 *
 * `source` mirrors the template registry: "remote" (fresh), "stale" (the
 * registry is down and this is the last good copy) or "unavailable" (down and
 * nothing cached).
 */
export const useGameCatalog = () => {
  const { data, isLoading, isFetching, refetch } =
    trpc.gameServer.catalog.list.useQuery();
  const [query, setQuery] = useState("");

  const games = useMemo<GameCatalogEntryT[]>(() => data?.games ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return games;
    return games.filter(
      (g) =>
        g.name.toLowerCase().includes(needle) ||
        g.id.toLowerCase().includes(needle) ||
        g.description.toLowerCase().includes(needle) ||
        (g.category ?? "").toLowerCase().includes(needle) ||
        (g.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
    );
  }, [games, query]);

  return {
    isLoading,
    games,
    filtered,
    query,
    setQuery,
    source: data?.source ?? "remote",
    error: data?.error,
    cachedAt: data?.cachedAt,
    isRefetching: isFetching && !isLoading,
    refetch,
  };
};
