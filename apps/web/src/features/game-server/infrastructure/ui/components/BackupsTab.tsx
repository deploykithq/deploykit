import { memo } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Download,
  HardDrive,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Select } from "@shared/components/select";
import { StatusBadge } from "@shared/components/status-badge";

import { useGameBackups } from "@game-server/infrastructure/ui/hooks/useGameBackups";

import { cn, formatBytes, timeAgo } from "@lib/utils";

import {
  BACKUP_TRIGGER_LABELS,
  CRON_PRESETS,
} from "@game-server/infrastructure/ui/constants/game-server.constants";

import type { GameServerTabPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const BackupsTab: React.FC<GameServerTabPropsI> = memo(function BackupsTab({
  server,
  permissions,
}) {
  const b = useGameBackups(server);
  const canOperate = permissions.canOperate;
  const isPreset = CRON_PRESETS.some((p) => p.value === b.backupCron);

  return (
    <div className="space-y-4">
      {/* Schedule */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium">Backup schedule</h3>
        </div>

        <div className="space-y-4">
          <label
            className={cn(
              "flex items-center gap-3",
              canOperate ? "cursor-pointer" : "cursor-not-allowed opacity-60",
            )}
          >
            <button
              type="button"
              role="switch"
              aria-checked={b.backupEnabled}
              disabled={!canOperate}
              onClick={() => b.setBackupEnabled((v) => !v)}
              className={cn(
                "w-9 h-5 rounded-full transition-colors relative",
                b.backupEnabled ? "bg-accent" : "bg-surface-3",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                  b.backupEnabled ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
            <span className="text-sm">
              {b.backupEnabled
                ? "Automatic backups enabled"
                : "Automatic backups disabled"}
            </span>
          </label>

          {b.backupEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Schedule"
                value={isPreset ? b.backupCron : "__custom"}
                onChange={(e) =>
                  b.setBackupCron(e.target.value === "__custom" ? "" : e.target.value)
                }
                options={[...CRON_PRESETS, { value: "__custom", label: "Custom cron…" }]}
                disabled={!canOperate}
              />
              {!isPreset && (
                <Input
                  label="Cron expression"
                  value={b.backupCron}
                  onChange={(e) => b.setBackupCron(e.target.value)}
                  placeholder="0 4 * * *"
                  className="font-mono"
                  disabled={!canOperate}
                />
              )}
            </div>
          )}

          <div className="max-w-xs space-y-1">
            <Input
              label="Keep the newest (backups)"
              type="number"
              value={b.backupRetention}
              onChange={(e) => b.setBackupRetention(e.target.value)}
              min={1}
              max={100}
              disabled={!canOperate}
            />
            <p className="text-[11px] text-text-muted">
              A number of archives, not days — worlds are large. Older ones are
              deleted after each successful backup.
            </p>
            {!b.retentionValid && (
              <p className="text-xs text-danger">Between 1 and 100.</p>
            )}
          </div>

          {b.configError && <p className="text-xs text-danger">{b.configError}</p>}

          {canOperate && (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={b.saveConfig}
                disabled={b.savingConfig || !b.retentionValid}
              >
                {b.savingConfig ? "Saving…" : "Save schedule"}
              </Button>
              {b.configSaved && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Saved
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* List */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium">World backups</h3>
          </div>
          {canOperate && (
            <Button
              size="sm"
              variant="secondary"
              onClick={b.create}
              disabled={b.creating || b.anyInProgress || server.status === "restoring"}
            >
              <Plus className="w-3.5 h-3.5" />
              {b.creating ? "Queuing…" : "Backup now"}
            </Button>
          )}
        </div>

        {(b.createError || b.deleteError || b.restoreError || b.downloadError) && (
          <div className="mb-3 p-2 rounded-lg bg-danger/10 text-danger text-xs flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {b.createError ?? b.deleteError ?? b.restoreError ?? b.downloadError}
          </div>
        )}

        {b.loading ? (
          <p className="text-sm text-text-muted py-4 text-center">Loading backups…</p>
        ) : b.backups.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">
            No backups yet.
            {canOperate && ' Click "Backup now" to create one.'}
          </p>
        ) : (
          <div className="space-y-1">
            {b.backups.map((backup) => {
              const done = backup.status === "success";
              return (
                <div
                  key={backup.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono truncate">
                        {backup.filename || "pending…"}
                      </p>
                      <StatusBadge status={backup.status} />
                    </div>
                    <p className="text-xs text-text-muted">
                      {BACKUP_TRIGGER_LABELS[backup.trigger] ?? backup.trigger}
                      {backup.sizeBytes ? ` · ${formatBytes(backup.sizeBytes)}` : ""}
                      {" · "}
                      {timeAgo(backup.finishedAt ?? backup.startedAt)}
                    </p>
                    {backup.error && (
                      <p className="text-xs text-danger mt-0.5 break-words">
                        {backup.error}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {done && permissions.canViewSecrets && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void b.download(backup)}
                        title="Download archive"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {done && canOperate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          b.setSafetyBackup(true);
                          b.setRestoreTarget(backup);
                        }}
                        disabled={server.status === "restoring"}
                        title="Restore this backup"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {canOperate && !["queued", "running"].includes(backup.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => b.setDeleteTarget(backup)}
                        title="Delete backup"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-danger" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Restore: a modal rather than ConfirmDialog, for the safety-backup option. */}
      <Modal
        open={!!b.restoreTarget}
        onClose={() => b.setRestoreTarget(null)}
        title="Restore world backup"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            The server stops, its world is replaced with{" "}
            <span className="font-mono text-text-primary">
              {b.restoreTarget?.filename}
            </span>
            , and it starts again. Progress since that backup is lost.
          </p>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={b.safetyBackup}
              onChange={(e) => b.setSafetyBackup(e.target.checked)}
              className="rounded border-border bg-surface-2 text-accent focus:ring-accent"
            />
            Take a safety backup of the current world first
          </label>
          {b.restoreError && <p className="text-xs text-danger">{b.restoreError}</p>}
          <div className="flex gap-2 justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => b.setRestoreTarget(null)}
              disabled={b.restoring}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={b.restore} disabled={b.restoring}>
              {b.restoring ? "Restoring…" : "Restore"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!b.deleteTarget}
        onClose={() => b.setDeleteTarget(null)}
        onConfirm={b.remove}
        title="Delete backup"
        description={`Permanently delete "${b.deleteTarget?.filename || "this backup"}"? This cannot be undone.`}
        confirmText="Delete"
        isPending={b.deleting}
      />
    </div>
  );
});
