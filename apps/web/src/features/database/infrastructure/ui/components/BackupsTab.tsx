import { memo } from "react";
import {
  Clock,
  HardDrive,
  Download,
  RotateCcw,
  Trash2,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

import { useBackupManager } from "@database/infrastructure/ui/hooks/useBackupManager";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { Input } from "@shared/components/input";
import { Select } from "@shared/components/select";

import { formatBytes, timeAgo, cn } from "@lib/utils";
import { useAuthStore } from "@lib/auth";

import { CRON_PRESETS } from "@database/infrastructure/ui/constants/database.constants";
import type { DatabaseI } from "@database/infrastructure/ui/interfaces/database.interfaces";

interface BackupsTabPropsI {
  db: DatabaseI;
  databaseId: string;
}

export const BackupsTab: React.FC<BackupsTabPropsI> = memo(function BackupsTab({
  db,
  databaseId,
}) {
  const canWrite = useAuthStore((s) => s.canWrite)();
  const isRedis = db.type === "redis";

  const {
    backups,
    loadingBackups,
    backupEnabled,
    setBackupEnabled,
    backupCron,
    setBackupCron,
    backupRetention,
    setBackupRetention,
    configSuccess,
    restoreTarget,
    setRestoreTarget,
    deleteTarget,
    setDeleteTarget,
    updateConfig,
    trigger,
    deleteBackup,
    restore,
    handleSaveConfig,
    handleTrigger,
    handleRestore,
    handleDeleteBackup,
  } = useBackupManager(db, databaseId);

  return (
    <div className="space-y-4">
      {/* Schedule config */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium">Backup Schedule</h3>
        </div>

        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className={cn(
                "w-9 h-5 rounded-full transition-colors relative",
                backupEnabled ? "bg-accent" : "bg-surface-3",
              )}
              onClick={() => setBackupEnabled((v) => !v)}
            >
              <div
                className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                  backupEnabled ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </div>
            <span className="text-sm">
              {backupEnabled
                ? "Automatic backups enabled"
                : "Automatic backups disabled"}
            </span>
          </label>

          {backupEnabled && (
            <>
              <Select
                label="Schedule"
                value={backupCron}
                onChange={(e) => setBackupCron(e.target.value)}
                options={CRON_PRESETS}
              />
              <Input
                label="Retention (days)"
                type="number"
                value={backupRetention}
                onChange={(e) => setBackupRetention(e.target.value)}
                min={1}
                max={365}
              />
            </>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={handleSaveConfig}
              disabled={updateConfig.isPending || !canWrite}
            >
              {updateConfig.isPending ? "Saving..." : "Save Config"}
            </Button>
            {configSuccess && (
              <span className="flex items-center gap-1 text-xs text-success">
                <CheckCircle className="w-3.5 h-3.5" />
                Saved
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Backups list */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium">Backups</h3>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleTrigger}
            disabled={trigger.isPending || db.status !== "running" || !canWrite}
          >
            <Download className="w-3.5 h-3.5" />
            {trigger.isPending ? "Queuing..." : "Backup Now"}
          </Button>
        </div>

        {trigger.isSuccess && (
          <div className="mb-3 p-2 rounded-lg bg-success/10 text-success text-xs flex items-center gap-2">
            <CheckCircle className="w-3.5 h-3.5" />
            Backup job queued. It may take a few moments to complete.
          </div>
        )}

        {loadingBackups ? (
          <p className="text-sm text-text-muted py-4 text-center">
            Loading backups...
          </p>
        ) : !backups?.length ? (
          <p className="text-sm text-text-muted py-4 text-center">
            No backups yet. Click "Backup Now" to create one.
          </p>
        ) : (
          <div className="space-y-1">
            {backups.map((backup) => (
              <div
                key={backup.filename}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-mono truncate">
                    {backup.filename}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatBytes(backup.size)} · {timeAgo(backup.createdAt)}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {canWrite && !isRedis && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRestoreTarget(backup.filename)}
                      title="Restore from this backup"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(backup.filename)}
                      title="Delete backup"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-danger" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Dialogs */}
      <ConfirmDialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
        title="Restore Backup"
        description={`This will overwrite the current database with the data from "${restoreTarget}". This action cannot be undone.`}
        confirmText={restore.isPending ? "Restoring..." : "Restore"}
        variant="primary"
        isPending={restore.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteBackup}
        title="Delete Backup"
        description={`Permanently delete "${deleteTarget}"? This cannot be undone.`}
        confirmText="Delete"
        isPending={deleteBackup.isPending}
      />

      {restore.error && (
        <div className="p-3 rounded-lg bg-danger/10 text-danger text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Restore failed: {restore.error.message}
        </div>
      )}
    </div>
  );
});
