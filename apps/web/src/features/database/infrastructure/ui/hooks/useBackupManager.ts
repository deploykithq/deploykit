import { useState } from "react";

import { trpc } from "@lib/trpc";

import {
  BACKUP_REFRESH_DELAY_MS,
  SUCCESS_FEEDBACK_MS,
} from "@database/infrastructure/ui/constants/database.constants";
import type {
  BackupI,
  DatabaseI,
} from "@database/infrastructure/ui/interfaces/database.interfaces";

interface BackupManagerResultPropsI {
  // list
  backups: BackupI[] | undefined;
  loadingBackups: boolean;
  // schedule config
  backupEnabled: boolean;
  setBackupEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  backupCron: string;
  setBackupCron: React.Dispatch<React.SetStateAction<string>>;
  backupRetention: string;
  setBackupRetention: React.Dispatch<React.SetStateAction<string>>;
  configSuccess: boolean;
  // dialogs
  restoreTarget: string | null;
  setRestoreTarget: React.Dispatch<React.SetStateAction<string | null>>;
  deleteTarget: string | null;
  setDeleteTarget: React.Dispatch<React.SetStateAction<string | null>>;
  // mutation states (no tRPC internals)
  updateConfig: MutationStateI;
  trigger: MutationStateI;
  deleteBackup: MutationStateI;
  restore: MutationStateI;
  handleSaveConfig: () => void;
  handleTrigger: () => void;
  handleRestore: () => void;
  handleDeleteBackup: () => void;
}

interface MutationStateI {
  isPending: boolean;
  isSuccess: boolean;
  error: { message: string } | null;
}

export const useBackupManager = (
  db: DatabaseI,
  databaseId: string,
): BackupManagerResultPropsI => {
  const utils = trpc.useUtils();

  const [backupEnabled, setBackupEnabled] = useState(db.backupEnabled);
  const [backupCron, setBackupCron] = useState(db.backupCron ?? "0 2 * * *");
  const [backupRetention, setBackupRetention] = useState(
    String(db.backupRetention ?? 7),
  );
  const [configSuccess, setConfigSuccess] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: backups, isLoading: loadingBackups } =
    trpc.database.listBackups.useQuery({ id: databaseId });

  const updateConfigMutation = trpc.database.updateBackupConfig.useMutation({
    onSuccess: () => {
      utils.database.byId.invalidate({ id: databaseId });
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), SUCCESS_FEEDBACK_MS);
    },
  });

  const triggerMutation = trpc.database.triggerBackup.useMutation({
    onSuccess: () => {
      setTimeout(
        () => utils.database.listBackups.invalidate({ id: databaseId }),
        BACKUP_REFRESH_DELAY_MS,
      );
    },
  });

  const deleteBackupMutation = trpc.database.deleteBackup.useMutation({
    onSuccess: () => {
      utils.database.listBackups.invalidate({ id: databaseId });
      setDeleteTarget(null);
    },
  });

  const restoreMutation = trpc.database.restoreBackup.useMutation({
    onSuccess: () => setRestoreTarget(null),
  });

  const handleSaveConfig = () =>
    updateConfigMutation.mutate({
      id: databaseId,
      backupEnabled,
      backupCron: backupEnabled ? backupCron : undefined,
      backupRetention: parseInt(backupRetention) || 7,
    });

  const handleTrigger = () => triggerMutation.mutate({ id: databaseId });

  const handleRestore = () => {
    if (restoreTarget)
      restoreMutation.mutate({ id: databaseId, filename: restoreTarget });
  };

  const handleDeleteBackup = () => {
    if (deleteTarget)
      deleteBackupMutation.mutate({ id: databaseId, filename: deleteTarget });
  };

  return {
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
    updateConfig: {
      isPending: updateConfigMutation.isPending,
      isSuccess: updateConfigMutation.isSuccess,
      error: updateConfigMutation.error,
    },
    trigger: {
      isPending: triggerMutation.isPending,
      isSuccess: triggerMutation.isSuccess,
      error: triggerMutation.error,
    },
    deleteBackup: {
      isPending: deleteBackupMutation.isPending,
      isSuccess: deleteBackupMutation.isSuccess,
      error: deleteBackupMutation.error,
    },
    restore: {
      isPending: restoreMutation.isPending,
      isSuccess: restoreMutation.isSuccess,
      error: restoreMutation.error,
    },
    handleSaveConfig,
    handleTrigger,
    handleRestore,
    handleDeleteBackup,
  };
};
