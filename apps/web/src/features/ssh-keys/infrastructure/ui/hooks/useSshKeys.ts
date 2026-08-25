import { useState } from "react";

import { trpc } from "@lib/trpc";

import type { DeleteSshKeyTargetI } from "@ssh-keys/infrastructure/ui/interfaces/ssh-keys.interfaces";

export const useSshKeys = () => {
  const utils = trpc.useUtils();

  const { data: sshKeys, isLoading } = trpc.sshKey.list.useQuery();

  const [showAddKey, setShowAddKey] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteSshKeyTargetI | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = trpc.sshKey.delete.useMutation({
    onSuccess: () => {
      utils.sshKey.list.invalidate();
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (err) => {
      setDeleteTarget(null);
      setDeleteError(err.message);
    },
  });

  const handleKeyCreated = () => {
    setShowAddKey(false);
    utils.sshKey.list.invalidate();
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
  };

  return {
    sshKeys,
    isLoading,
    showAddKey,
    setShowAddKey,
    deleteTarget,
    setDeleteTarget,
    deleteError,
    dismissDeleteError: () => setDeleteError(null),
    deleting: deleteMutation.isPending,
    handleKeyCreated,
    handleConfirmDelete,
  };
};
