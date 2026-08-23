import { useState } from "react";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

import type { DeleteServerTargetI } from "@server/infrastructure/ui/interfaces/server.interfaces";

export const useServers = () => {
  const utils = trpc.useUtils();
  const isAdmin = useAuthStore((s) => s.isAdmin)();

  const { data: servers, isLoading } = trpc.server.list.useQuery();

  const [showAddServer, setShowAddServer] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteServerTargetI | null>(
    null,
  );

  const createLocalMutation = trpc.server.createLocal.useMutation({
    onSuccess: () => utils.server.list.invalidate(),
  });

  const deleteMutation = trpc.server.delete.useMutation({
    onSuccess: () => {
      utils.server.list.invalidate();
      setDeleteTarget(null);
    },
  });

  const hasLocal = servers?.some((s) => s.isLocal);

  const handleServerCreated = () => {
    setShowAddServer(false);
    utils.server.list.invalidate();
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
  };

  return {
    servers,
    isLoading,
    isAdmin,
    hasLocal,
    showAddServer,
    setShowAddServer,
    showCleanup,
    setShowCleanup,
    deleteTarget,
    setDeleteTarget,
    creatingLocal: createLocalMutation.isPending,
    createLocalServer: () => createLocalMutation.mutate(),
    deleting: deleteMutation.isPending,
    handleServerCreated,
    handleConfirmDelete,
  };
};
