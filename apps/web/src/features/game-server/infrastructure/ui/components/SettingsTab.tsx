import { memo } from "react";
import { AlertTriangle, Check } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { GamePortsFields } from "@game-server/infrastructure/ui/components/GamePortsFields";
import { GameServerForm } from "@game-server/infrastructure/ui/components/GameServerForm";
import { MemoryField } from "@game-server/infrastructure/ui/components/MemoryField";

import { useGameSettings } from "@game-server/infrastructure/ui/hooks/useGameSettings";

import { trpc } from "@lib/trpc";

import type { GameServerTabPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const SettingsTab: React.FC<GameServerTabPropsI> = memo(function SettingsTab({
  server,
  permissions,
}) {
  const { form, handleSubmit, saving, error, savedNote } = useGameSettings(server);
  const readOnly = !permissions.canOperate;
  const busy = server.status === "provisioning" || server.status === "restoring";

  // Installed mods are pinned to a loader and game version: changing either
  // here does not re-check them.
  const mods = server.spec.mods;
  const modsQuery = trpc.gameServer.mods.list.useQuery(
    { id: server.id },
    { enabled: Boolean(mods) },
  );
  const modKeys = [mods?.loader?.from, mods?.gameVersion?.from].filter(
    (k): k is string => Boolean(k),
  );
  const changesModTarget =
    (modsQuery.data?.mods.length ?? 0) > 0 &&
    !modsQuery.data?.modpack &&
    modKeys.some((k) => String(form.values[k] ?? "") !== String(server.values[k] ?? ""));

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {readOnly && (
        <p className="text-xs text-text-muted">
          Only operators and admins of this project can change these settings.
        </p>
      )}

      <Card>
        <h3 className="text-sm font-medium mb-4">Game settings</h3>
        <GameServerForm
          spec={server.spec}
          values={form.values}
          errors={form.errors}
          onChange={form.setValue}
          mode="update"
          disabled={readOnly}
        />
        {changesModTarget && (
          <p className="flex items-start gap-1.5 text-xs text-warning mt-4">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            This server has mods pinned to its current loader and version. After this change,
            check them in the Mods tab — mods that do not fit can stop the server from starting.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-medium mb-4">Ports</h3>
        <GamePortsFields
          spec={server.spec}
          ports={form.ports}
          errors={form.portErrors}
          onChange={form.setPort}
          disabled={readOnly}
        />
      </Card>

      <Card>
        <MemoryField
          min={server.spec.resources.memoryMb.min}
          recommended={server.spec.resources.memoryMb.recommended}
          value={form.memoryMb}
          onChange={form.setMemoryMb}
          disabled={readOnly}
        />
        {form.memoryError && (
          <p className="text-xs text-danger mt-1">{form.memoryError}</p>
        )}
      </Card>

      {!readOnly && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-900/10 p-3">
            <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
            <p className="text-xs text-text-secondary">
              Saving recreates the container with the new settings, so a running
              server will restart and disconnect its players.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-danger whitespace-pre-wrap">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || busy}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={form.reset}
              disabled={saving}
            >
              Discard changes
            </Button>
            {savedNote && (
              <span className="text-xs text-success flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> {savedNote}
              </span>
            )}
          </div>
        </>
      )}
    </form>
  );
});
