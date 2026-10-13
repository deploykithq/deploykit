import { memo, useState } from "react";
import { Boxes, Gamepad2 } from "lucide-react";

import { AddModsModal } from "@game-server/infrastructure/ui/components/AddModsModal";

import { trpc } from "@lib/trpc";
import { cn } from "@lib/utils";

import type { ModpackPickerPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** "The plain game / a modpack", for games that declare modpacks. */
export const ModpackPicker: React.FC<ModpackPickerPropsI> = memo(function ModpackPicker({
  gameId,
  value,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const sourcesQuery = trpc.gameServer.mods.sourcesForGame.useQuery({ gameId });
  const sources = (sourcesQuery.data ?? []).filter((s) => s.modpacks);
  if (sources.length === 0) return null;

  const option = (selected: boolean) =>
    cn(
      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
      selected ? "border-accent bg-accent/5" : "border-border hover:border-text-muted",
    );

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Start from</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button type="button" onClick={() => onChange(null)} className={option(!value)}>
          <span className="flex items-center gap-1.5 font-medium">
            <Gamepad2 className="w-3.5 h-3.5" /> The plain game
          </span>
          <span className="block text-xs text-text-muted">
            Pick the server type and version below; add mods later.
          </span>
        </button>
        <button type="button" onClick={() => setOpen(true)} className={option(Boolean(value))}>
          <span className="flex items-center gap-1.5 font-medium truncate">
            <Boxes className="w-3.5 h-3.5 shrink-0" /> {value ? value.name : "A modpack"}
          </span>
          <span className="block text-xs text-text-muted">
            {value
              ? "The pack decides the loader and version. Click to change it."
              : "Search a catalogue for a ready-made pack."}
          </span>
        </button>
      </div>
      {open && (
        <AddModsModal
          open={open}
          onClose={() => setOpen(false)}
          sources={sources}
          mode="modpack"
          gameId={gameId}
          onPickModpack={(pick) => {
            onChange(pick);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
});
