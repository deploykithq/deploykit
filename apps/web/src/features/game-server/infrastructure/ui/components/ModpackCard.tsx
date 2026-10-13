import { memo } from "react";
import { Boxes } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { MOD_SOURCE_LABELS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type { ModpackCardPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const ModpackCard: React.FC<ModpackCardPropsI> = memo(function ModpackCard({
  modpack,
  canEdit,
  hasModpackSources,
  busy,
  onChange,
  onRemove,
}) {
  if (!hasModpackSources) return null;

  return (
    <Card>
      <div className="flex items-center gap-3">
        {modpack?.iconUrl ? (
          <img src={modpack.iconUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded bg-surface-2 flex items-center justify-center shrink-0">
            <Boxes className="w-5 h-5 text-text-muted" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-muted uppercase tracking-wider">Modpack</p>
          {modpack ? (
            <>
              <p className="text-sm font-medium truncate">
                {modpack.name}{" "}
                <span className="text-text-muted font-normal">
                  · {modpack.versionLabel} · {MOD_SOURCE_LABELS[modpack.source]}
                </span>
              </p>
              {modpack.gameVersion && (
                <p className="text-xs text-text-muted">
                  Runs {[modpack.loader, modpack.gameVersion].filter(Boolean).join(" ")}. Check that
                  the server's settings (such as its Java version) fit {modpack.gameVersion}.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              None — the server runs the type and version chosen in Settings.
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="secondary" disabled={busy} onClick={onChange}>
              {modpack ? "Change" : "Choose a modpack"}
            </Button>
            {modpack && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
});
