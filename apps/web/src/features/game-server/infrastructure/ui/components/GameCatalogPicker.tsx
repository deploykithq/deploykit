import { memo, useState } from "react";
import { Gamepad2, Loader2, RefreshCw, Search, Users, WifiOff } from "lucide-react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";

import { useGameCatalog } from "@game-server/infrastructure/ui/hooks/useGameCatalog";

import { cn } from "@lib/utils";

import type {
  GameCatalogEntryT,
  GameCatalogPickerPropsI,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** Logo from the remote registry, falling back to an icon if it fails to load. */
const GameLogo: React.FC<{ game: GameCatalogEntryT }> = ({ game }) => {
  const [failed, setFailed] = useState(false);
  const show = !!game.logoUrl && !failed;
  return (
    <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-accent shrink-0 overflow-hidden">
      {show ? (
        <img
          src={game.logoUrl}
          alt=""
          className="w-6 h-6 object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Gamepad2 className="w-5 h-5" />
      )}
    </div>
  );
};

/** Step 1 of the new-game-server modal: choose a game from the catalogue. */
export const GameCatalogPicker: React.FC<GameCatalogPickerPropsI> = memo(
  function GameCatalogPicker({ onSelect }) {
    const {
      isLoading,
      games,
      filtered,
      query,
      setQuery,
      source,
      error,
      cachedAt,
      isRefetching,
      refetch,
    } = useGameCatalog();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-40 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      );
    }

    if (source === "unavailable") {
      return (
        <div className="text-center py-10 space-y-3">
          <WifiOff className="w-6 h-6 text-text-muted mx-auto" />
          <div>
            <p className="text-sm text-text-secondary">
              Cannot reach the game catalogue, and nothing is cached yet.
            </p>
            <p className="text-xs text-text-muted mt-1">
              Games are fetched from the public template catalogue rather than
              shipped inside DeployKit. Check this server's outbound access, or
              point
              <code className="mx-1">TEMPLATES_REGISTRY_URL</code>
              at a reachable catalogue.
            </p>
            {error && (
              <p className="text-[11px] text-text-muted mt-2 font-mono">{error}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
            {isRefetching ? "Retrying…" : "Retry"}
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {source === "stale" && (
          <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/30 bg-yellow-900/10 p-3">
            <WifiOff className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
            <div className="text-xs text-text-secondary">
              <p>
                The game catalogue is unreachable, so this is the last copy
                DeployKit fetched
                {cachedAt ? ` (${new Date(cachedAt).toLocaleString()})` : ""}.
                It may be older than what is published.
              </p>
              {error && (
                <p className="text-text-muted mt-1 font-mono text-[11px]">{error}</p>
              )}
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games…"
            className="pl-9"
            autoComplete="off"
            autoFocus
          />
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-8">
            {games.length === 0
              ? "The catalogue has no games yet."
              : `No games match “${query}”.`}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[50dvh] overflow-y-auto -mx-1 px-1">
            {filtered.map((game) => (
              <button
                key={game.id}
                type="button"
                onClick={() => onSelect(game)}
                className="w-full flex items-start gap-3 text-left rounded-lg border border-border bg-surface-2/40 hover:bg-surface-2 hover:border-border-hover px-3 py-2.5 transition-colors"
              >
                <GameLogo game={game} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium truncate">{game.name}</span>
                    <span className="text-[10px] text-text-muted font-mono shrink-0">
                      {game.version}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary line-clamp-2 mt-0.5">
                    {game.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {game.category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-muted text-accent">
                        {game.category}
                      </span>
                    )}
                    {game.players && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted flex items-center gap-1">
                        <Users className="w-2.5 h-2.5" />
                        {game.players.min}–{game.players.max}
                      </span>
                    )}
                    {(game.tags ?? []).slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
