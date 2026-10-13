import { memo } from "react";
import { ArrowUpCircle, Package, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";

import { cn } from "@lib/utils";

import { MOD_SOURCE_LABELS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type { ModRowPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const ModRow: React.FC<ModRowPropsI> = memo(function ModRow({
  mod,
  update,
  canEdit,
  busy,
  onToggle,
  onRemove,
  onUpdate,
}) {
  return (
    <li className={cn("flex items-center gap-3 py-2.5", !mod.enabled && "opacity-60")}>
      {mod.iconUrl ? (
        <img
          src={mod.iconUrl}
          alt=""
          className="w-8 h-8 rounded object-cover bg-surface-2 shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-8 h-8 rounded bg-surface-2 flex items-center justify-center shrink-0">
          <Package className="w-4 h-4 text-text-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{mod.name}</p>
        <p className="text-xs text-text-muted truncate">
          {MOD_SOURCE_LABELS[mod.source]} · {mod.versionLabel ?? "latest"}
          {mod.source === "steam-workshop" && " · always the latest upload"}
          {mod.kind === "plugin" && " · plugin"}
        </p>
      </div>
      {update && canEdit && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={onUpdate}
          title={`Update to ${update.label}`}
        >
          <ArrowUpCircle className="w-3.5 h-3.5" />
          Update
        </Button>
      )}
      <label className="flex items-center gap-1.5 text-xs text-text-secondary shrink-0">
        <input
          type="checkbox"
          checked={mod.enabled}
          disabled={!canEdit || busy}
          onChange={(e) => onToggle(e.target.checked)}
        />
        Enabled
      </label>
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Remove ${mod.name}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </li>
  );
});
