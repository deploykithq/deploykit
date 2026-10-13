import { useEffect, useState } from "react";

import { trpc } from "@lib/trpc";

import { MOD_SEARCH_DEBOUNCE_MS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type {
  ModSearchHitT,
  ModSourceIdT,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * Debounced, paged catalogue search: a server's compatible mods, or a game's
 * modpacks before the server exists.
 */
export const useModSearch = (opts: {
  serverId?: string;
  gameId?: string;
  source: ModSourceIdT | null;
  kind: "mod" | "modpack";
  enabled: boolean;
}) => {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  const [hits, setHits] = useState<ModSearchHitT[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), MOD_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setOffset(0);
    setHits([]);
  }, [debounced, opts.source, opts.kind]);

  // Mods are searched for a server (filtered for it); modpacks per game.
  const forServer = Boolean(opts.serverId) && opts.kind !== "modpack";
  const serverQuery = trpc.gameServer.mods.search.useQuery(
    { id: opts.serverId ?? "", source: opts.source ?? "modrinth", query: debounced, offset },
    { enabled: opts.enabled && forServer && Boolean(opts.source), staleTime: 60_000 },
  );
  const packQuery = trpc.gameServer.mods.searchModpacks.useQuery(
    { gameId: opts.gameId ?? "", source: opts.source ?? "modrinth", query: debounced, offset },
    {
      enabled: opts.enabled && !forServer && Boolean(opts.gameId) && Boolean(opts.source),
      staleTime: 60_000,
    },
  );
  const active = forServer ? serverQuery : packQuery;

  useEffect(() => {
    if (!active.data) return;
    const page = active.data.hits;
    setHits((prev) => (offset === 0 ? page : [...prev, ...page]));
  }, [active.data, offset]);

  const total = active.data?.total ?? 0;

  return {
    query,
    setQuery,
    hits,
    total,
    loading: active.isFetching,
    error: active.error?.message ?? null,
    hasMore: hits.length < total,
    loadMore: () => setOffset(hits.length),
  };
};
