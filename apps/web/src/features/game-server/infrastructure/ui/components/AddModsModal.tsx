import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, Link2, Loader2, Package } from "lucide-react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";

import { useModSearch } from "@game-server/infrastructure/ui/hooks/useModSearch";

import { trpc } from "@lib/trpc";
import { cn } from "@lib/utils";

import { MOD_SOURCE_LABELS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type {
  AddModsModalPropsI,
  ModSourceIdT,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

const formatCount = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${Math.round(n / 1_000)}k`
      : String(n);

/**
 * Search a catalogue and install (mode "mods"), or pick a modpack (mode
 * "modpack"). Mod results are already filtered to what fits the server.
 *
 * Rendered through a portal: the create modal opens it from inside its own
 * <form>, and a nested form (or a button inheriting type="submit") would
 * submit the new server.
 */
export const AddModsModal: React.FC<AddModsModalPropsI> = memo(function AddModsModal({
  open,
  onClose,
  sources,
  mode,
  serverId,
  gameId,
  onPickModpack,
}) {
  const usable = sources.filter((s) => (mode === "modpack" ? s.modpacks : true));
  const [source, setSource] = useState<ModSourceIdT | null>(usable[0]?.id ?? null);
  const [pasted, setPasted] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const current = usable.find((s) => s.id === source) ?? null;
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!source && usable[0]) setSource(usable[0].id);
  }, [source, usable]);

  const search = useModSearch({
    serverId,
    gameId,
    source,
    kind: mode === "modpack" ? "modpack" : "mod",
    enabled: open && Boolean(current?.search),
  });

  const addMutation = trpc.gameServer.mods.add.useMutation({
    onSuccess: (mod) => {
      setAdded((prev) => new Set(prev).add(mod.projectId));
      setPasted("");
      if (serverId) utils.gameServer.mods.list.invalidate({ id: serverId });
    },
  });

  const pick = (ref: string, name: string) => {
    if (!source) return;
    if (mode === "modpack") onPickModpack?.({ source, ref, name });
    else if (serverId) addMutation.mutate({ id: serverId, source, ref });
  };

  const verb = mode === "modpack" ? "Use" : "Add";

  return createPortal(
    <Modal open={open} onClose={onClose} title={mode === "modpack" ? "Choose a modpack" : "Add mods"}>
      <div className="space-y-4">
        {usable.length > 1 && (
          <div className="flex gap-1 border-b border-border">
            {usable.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSource(s.id)}
                className={cn(
                  "px-3 py-1.5 text-sm -mb-px border-b-2 transition-colors",
                  source === s.id
                    ? "border-accent text-text-primary"
                    : "border-transparent text-text-secondary hover:text-text-primary",
                )}
              >
                {MOD_SOURCE_LABELS[s.id]}
              </button>
            ))}
          </div>
        )}

        {current && !current.install && <p className="text-sm text-warning">{current.reason}</p>}

        {current?.install && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const ref = pasted.trim();
              // Until the API resolves it, name a pasted link by its last path segment.
              const label = ref.replace(/\/+$/, "").split(/[/?=]/).pop() || ref;
              if (ref) pick(ref, label);
            }}
          >
            <Input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={`Paste a ${MOD_SOURCE_LABELS[current.id]} link or id`}
              aria-label="Link or id"
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={!pasted.trim() || addMutation.isPending}
            >
              <Link2 className="w-3.5 h-3.5" />
              {verb}
            </Button>
          </form>
        )}

        {current?.install && !current.search && current.reason && (
          <p className="text-xs text-text-muted">{current.reason}</p>
        )}

        {addMutation.error && <p className="text-sm text-danger">{addMutation.error.message}</p>}

        {current?.search && (
          <>
            <Input
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              placeholder={mode === "modpack" ? "Search modpacks" : "Search mods"}
              aria-label="Search"
              autoFocus
            />
            {search.error && <p className="text-sm text-danger">{search.error}</p>}
            <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border">
              {search.hits.map((hit) => {
                const done = added.has(hit.projectId);
                return (
                  <li key={hit.projectId} className="flex items-start gap-3 py-2.5">
                    {hit.iconUrl ? (
                      <img
                        src={hit.iconUrl}
                        alt=""
                        className="w-9 h-9 rounded object-cover shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded bg-surface-2 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-text-muted" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {hit.name}
                        <a
                          href={hit.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1 inline-flex text-text-muted hover:text-text-primary"
                          aria-label={`Open ${hit.name}`}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </p>
                      <p className="text-xs text-text-muted line-clamp-2">{hit.summary}</p>
                      <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1 flex-wrap">
                        <Download className="w-3 h-3" /> {formatCount(hit.downloads)}
                        {hit.author && <span>· {hit.author}</span>}
                        {!hit.installable && hit.reason && (
                          <span className="text-warning">· {hit.reason}</span>
                        )}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={done ? "ghost" : "secondary"}
                      disabled={!hit.installable || done || addMutation.isPending}
                      onClick={() => pick(hit.projectId, hit.name)}
                    >
                      {done ? "Added" : verb}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {search.loading && (
              <Loader2 className="w-4 h-4 animate-spin text-text-muted mx-auto" />
            )}
            {!search.loading && search.hits.length === 0 && !search.error && (
              <p className="text-sm text-text-muted text-center py-4">
                {mode === "modpack" ? "No modpacks found." : "Nothing found that fits this server."}
              </p>
            )}
            {search.hasMore && !search.loading && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={search.loadMore}
              >
                Load more
              </Button>
            )}
          </>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-text-muted">
            {mode === "mods"
              ? "Mods are downloaded by the server when you apply the changes, which restarts it."
              : ""}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {mode === "mods" && added.size > 0 ? "Done" : "Close"}
          </Button>
        </div>
      </div>
    </Modal>,
    document.body,
  );
});
