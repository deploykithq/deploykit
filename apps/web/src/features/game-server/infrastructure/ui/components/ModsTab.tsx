import { memo } from "react";
import { AlertTriangle, FolderOpen, Loader2, Plus, Puzzle, RefreshCw } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { EmptyState } from "@shared/components/empty-state";

import { AddModsModal } from "@game-server/infrastructure/ui/components/AddModsModal";
import { ModRow } from "@game-server/infrastructure/ui/components/ModRow";
import { ModpackCard } from "@game-server/infrastructure/ui/components/ModpackCard";
import { useGameMods } from "@game-server/infrastructure/ui/hooks/useGameMods";

import type { GameServerTabPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * Mods and modpacks. Changes are kept as a list and applied together:
 * applying rebuilds the container, and the server downloads what changed.
 */
export const ModsTab: React.FC<GameServerTabPropsI> = memo(function ModsTab({ server }) {
  const m = useGameMods(server);
  const data = m.data;

  if (m.loading) return <Loader2 className="w-5 h-5 animate-spin text-text-muted" />;
  if (m.error || !data) {
    return <p className="text-sm text-danger">{m.error ?? "Could not load mods"}</p>;
  }

  const filterLabel = data.filter
    ? [data.filter.loaders?.[0], data.filter.gameVersion].filter(Boolean).join(" ")
    : "";

  return (
    <div className="space-y-4">
      {data.pending && (
        <Card className="border-warning/40">
          <div className="flex flex-wrap items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            <p className="text-sm flex-1 min-w-48">
              Changes pending — they take effect when the server is rebuilt.
              {data.destructive &&
                " Mods are being removed or the modpack changes: a safety backup runs first."}
            </p>
            {m.canEdit && (
              <>
                {!data.destructive && (
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={m.safetyBackup}
                      onChange={(e) => m.setSafetyBackup(e.target.checked)}
                    />
                    Back up first
                  </label>
                )}
                <Button size="sm" onClick={m.apply} disabled={m.applying}>
                  {m.applying ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Apply & restart
                </Button>
              </>
            )}
          </div>
          {m.applyError && <p className="text-sm text-danger mt-2">{m.applyError}</p>}
          {!m.applyError && server.statusMessage && (
            <p className="text-sm text-danger mt-2">{server.statusMessage}</p>
          )}
        </Card>
      )}
      {m.applied && (
        <p className="text-xs text-text-muted">
          {m.applied.appliesOnStart
            ? "The server has not been built yet: these mods are installed on its first start."
            : `Queued${m.applied.safetyBackup ? " after a safety backup" : ""}. The server downloads its mods as it starts: follow it in the Console or Logs tab.`}
        </p>
      )}
      {data.followsLatest && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          This server follows the latest game version, but its mods are pinned. Set a fixed version
          in Settings so the next release cannot leave the mods behind.
        </p>
      )}

      <ModpackCard
        modpack={data.modpack}
        canEdit={m.canEdit}
        hasModpackSources={m.hasModpackSources}
        busy={m.settingModpack}
        onChange={() => m.setModpackOpen(true)}
        onRemove={() => m.setModpack(null)}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Puzzle className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium flex-1">Installed</h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={m.checkUpdates}
            disabled={m.checkingUpdates || data.mods.length === 0 || Boolean(data.unsupported)}
          >
            {m.checkingUpdates ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Check for updates
          </Button>
          {m.canEdit && (
            <Button size="sm" onClick={() => m.setAddOpen(true)} disabled={Boolean(data.unsupported)}>
              <Plus className="w-3.5 h-3.5" />
              Add mods
            </Button>
          )}
        </div>
        {data.unsupported && <p className="text-sm text-warning mb-2">{data.unsupported}</p>}
        {filterLabel && (
          <p className="text-xs text-text-muted mb-2">Showing what fits {filterLabel}.</p>
        )}
        {m.updatesChecked && m.updates.size === 0 && data.mods.length > 0 && (
          <p className="text-xs text-text-muted mb-2">Everything is up to date.</p>
        )}
        {m.updatesError && <p className="text-sm text-danger mb-2">{m.updatesError}</p>}
        {m.mutationError && <p className="text-sm text-danger mb-2">{m.mutationError}</p>}
        {data.mods.length === 0 ? (
          <EmptyState
            icon={<Puzzle className="w-6 h-6" />}
            title="No mods yet"
            description="Search a catalogue or paste a link to add mods to this server."
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.mods.map((mod) => {
              const update = m.updates.get(mod.id);
              return (
                <ModRow
                  key={mod.id}
                  mod={mod}
                  update={update}
                  canEdit={m.canEdit}
                  busy={m.busyId === mod.id}
                  onToggle={(enabled) => m.toggle(mod.id, enabled)}
                  onRemove={() => m.remove(mod.id)}
                  onUpdate={() => update && m.updateTo(mod.id, update.versionId)}
                />
              );
            })}
          </ul>
        )}
      </Card>

      {data.onDisk.some((d) => d.files.length > 0) && (
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium">On disk</h3>
          </div>
          <p className="text-xs text-text-muted mb-2">
            Files in the mod folders, including ones uploaded by hand from the Files tab.
          </p>
          {data.onDisk.map((d) => (
            <div key={d.directory} className="text-xs mb-2">
              <p className="font-mono text-text-secondary">{d.directory}/</p>
              <p className="text-text-muted break-words">{d.files.join(", ") || "empty"}</p>
            </div>
          ))}
        </Card>
      )}

      {m.addOpen && (
        <AddModsModal
          open={m.addOpen}
          onClose={() => m.setAddOpen(false)}
          sources={m.sources}
          mode="mods"
          serverId={server.id}
        />
      )}
      {m.modpackOpen && (
        <AddModsModal
          open={m.modpackOpen}
          onClose={() => m.setModpackOpen(false)}
          sources={m.sources}
          mode="modpack"
          gameId={server.gameId}
          onPickModpack={(pick) =>
            m.setModpack({ source: pick.source, ref: pick.ref, versionId: pick.versionId })
          }
        />
      )}
    </div>
  );
});
