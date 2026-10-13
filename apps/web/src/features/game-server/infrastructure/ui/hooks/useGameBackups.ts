import { useEffect, useState } from "react";

import { trpc } from "@lib/trpc";

import {
  BACKUPS_POLL_MS,
  DEFAULT_BACKUP_CRON,
  DEFAULT_BACKUP_RETENTION,
  SAVED_FEEDBACK_MS,
} from "@game-server/infrastructure/ui/constants/game-server.constants";
import { downloadWithAuth } from "@game-server/infrastructure/ui/utils/game-server.utils";

import type {
  GameBackupT,
  GameServerDetailT,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

const inProgress = (b: GameBackupT) => b.status === "queued" || b.status === "running";

/**
 * World backups: the list (polled while one is in progress), manual backups,
 * restore, delete, download and the schedule.
 */
export const useGameBackups = (server: GameServerDetailT) => {
  const utils = trpc.useUtils();

  const [backupEnabled, setBackupEnabled] = useState(server.backupEnabled);
  const [backupCron, setBackupCron] = useState(server.backupCron ?? DEFAULT_BACKUP_CRON);
  const [backupRetention, setBackupRetention] = useState(
    String(server.backupRetention ?? DEFAULT_BACKUP_RETENTION),
  );
  const [configSaved, setConfigSaved] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<GameBackupT | null>(null);
  const [safetyBackup, setSafetyBackup] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<GameBackupT | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setBackupEnabled(server.backupEnabled);
    setBackupCron(server.backupCron ?? DEFAULT_BACKUP_CRON);
    setBackupRetention(String(server.backupRetention ?? DEFAULT_BACKUP_RETENTION));
  }, [server.backupEnabled, server.backupCron, server.backupRetention]);

  const listQuery = trpc.gameServer.backups.list.useQuery(
    { id: server.id },
    {
      refetchInterval: (query) =>
        (query.state.data ?? []).some(inProgress) ? BACKUPS_POLL_MS : false,
    },
  );

  const invalidateList = () => utils.gameServer.backups.list.invalidate({ id: server.id });
  const invalidateServer = () => utils.gameServer.byId.invalidate({ id: server.id });

  const createMutation = trpc.gameServer.backups.create.useMutation({
    onSuccess: invalidateList,
  });
  const restoreMutation = trpc.gameServer.backups.restore.useMutation({
    onSuccess: () => {
      setRestoreTarget(null);
      invalidateList();
      invalidateServer();
    },
  });
  const deleteMutation = trpc.gameServer.backups.delete.useMutation({
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateList();
    },
  });
  const configMutation = trpc.gameServer.backups.updateConfig.useMutation({
    onSuccess: () => {
      invalidateServer();
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), SAVED_FEEDBACK_MS);
    },
  });

  const retentionNumber = Number(backupRetention);
  const retentionValid =
    Number.isInteger(retentionNumber) && retentionNumber >= 1 && retentionNumber <= 100;

  const saveConfig = () => {
    if (!retentionValid) return;
    configMutation.mutate({
      id: server.id,
      backupEnabled,
      backupCron: backupEnabled ? backupCron.trim() : undefined,
      backupRetention: retentionNumber,
    });
  };

  const download = async (backup: GameBackupT) => {
    setDownloadError(null);
    try {
      await downloadWithAuth(
        `/api/game-servers/${server.id}/backups/${backup.id}/download`,
        `${server.name}-${backup.filename}`,
      );
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const backups = listQuery.data ?? [];

  return {
    backups,
    loading: listQuery.isLoading,
    anyInProgress: backups.some(inProgress),
    // schedule
    backupEnabled,
    setBackupEnabled,
    backupCron,
    setBackupCron,
    backupRetention,
    setBackupRetention,
    retentionValid,
    saveConfig,
    savingConfig: configMutation.isPending,
    configError: configMutation.error?.message ?? null,
    configSaved,
    // actions
    create: () => createMutation.mutate({ id: server.id }),
    creating: createMutation.isPending,
    createError: createMutation.error?.message ?? null,
    restoreTarget,
    setRestoreTarget,
    safetyBackup,
    setSafetyBackup,
    restore: () => {
      if (restoreTarget) {
        restoreMutation.mutate({
          id: server.id,
          backupId: restoreTarget.id,
          safetyBackup,
        });
      }
    },
    restoring: restoreMutation.isPending,
    restoreError: restoreMutation.error?.message ?? null,
    deleteTarget,
    setDeleteTarget,
    remove: () => {
      if (deleteTarget) deleteMutation.mutate({ id: server.id, backupId: deleteTarget.id });
    },
    deleting: deleteMutation.isPending,
    deleteError: deleteMutation.error?.message ?? null,
    download,
    downloadError,
  };
};
