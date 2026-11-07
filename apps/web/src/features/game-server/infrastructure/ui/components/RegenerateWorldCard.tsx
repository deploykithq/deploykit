import { memo } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";

import { GameVariableField } from "@game-server/infrastructure/ui/components/GameVariableField";

import { useRegenerateWorld } from "@game-server/infrastructure/ui/hooks/useRegenerateWorld";

import type { RegenerateWorldCardPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * Throw the world away and let the game generate a new one, keeping mods and
 * their configs. The world's creation values (seed, size) are locked in the
 * settings form, and this is where they can be set again.
 *
 * Rendered outside the Settings <form>: its own fields must not submit it.
 */
export const RegenerateWorldCard: React.FC<RegenerateWorldCardPropsI> = memo(
  function RegenerateWorldCard({ server, permissions, busy }) {
    const w = useRegenerateWorld(server, permissions.canOperate);
    if (!w.canEdit || (!w.available && !w.unavailableReason)) return null;

    return (
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">World</h3>
            <p className="text-xs text-text-muted mt-1">
              {w.available
                ? "Delete the world and start over with a new one. Mods, their configs and the server settings are kept."
                : w.unavailableReason}
            </p>
            {w.note && (
              <p className="text-xs text-success flex items-center gap-1 mt-2">
                <Check className="w-3.5 h-3.5" /> {w.note}
              </p>
            )}
          </div>
          {w.available && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => w.setOpen(true)}
              disabled={busy}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate world
            </Button>
          )}
        </div>

        <Modal open={w.open} onClose={() => w.setOpen(false)} title="Regenerate world">
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="text-xs text-text-secondary space-y-1">
                <p>
                  The server stops, its world is deleted and it starts again with a new one. Players
                  lose everything built in this world.
                </p>
                <p>
                  A backup is taken first, and nothing is deleted if it fails: you can restore the
                  old world from the Backups tab.
                </p>
              </div>
            </div>

            <div className="text-xs text-text-muted">
              <p className="mb-1">Deleted:</p>
              <ul className="list-disc pl-5 font-mono">
                {w.paths.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>

            {w.variables.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-text-muted">The new world is created with:</p>
                {w.variables.map((v) => (
                  <GameVariableField
                    key={v.key}
                    variable={v}
                    value={w.values[v.key]}
                    error={w.errors[v.key]}
                    onChange={(value) => w.setValue(v.key, value)}
                    mode="create"
                    disabled={w.pending}
                  />
                ))}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="regenerate-confirm" className="text-xs text-text-secondary">
                Type <span className="font-mono text-text-primary">{server.name}</span> to confirm
              </label>
              <Input
                id="regenerate-confirm"
                value={w.confirmName}
                onChange={(e) => w.setConfirmName(e.target.value)}
                autoComplete="off"
              />
            </div>

            {w.error && <p className="text-xs text-danger whitespace-pre-wrap">{w.error}</p>}

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => w.setOpen(false)}
                disabled={w.pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={w.submit}
                disabled={!w.confirmed || w.pending}
              >
                {w.pending ? "Queuing…" : "Delete and regenerate"}
              </Button>
            </div>
          </div>
        </Modal>
      </Card>
    );
  },
);
