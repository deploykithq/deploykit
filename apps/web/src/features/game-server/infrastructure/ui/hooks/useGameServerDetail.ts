import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { gameServerDetailRoute } from "@/router";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

import {
  STATUS_POLL_MS,
  TABS,
  TRANSITIONAL_STATUSES,
} from "@game-server/infrastructure/ui/constants/game-server.constants";

import type {
  GameServerPermissionsI,
  GameServerTabT,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * The game server page: the row (polled while provisioning or restoring), the
 * caller's permissions and the lifecycle actions.
 *
 * Permissions mirror the API. Project operator+ runs the server; project admin
 * deletes it; console commands and file writes additionally need the *global*
 * operator role, because they are as powerful as the web terminal.
 */
export const useGameServerDetail = () => {
  const { projectId, gameServerId } = gameServerDetailRoute.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<GameServerTabT>("general");
  const [showDelete, setShowDelete] = useState(false);
  const [deleteData, setDeleteData] = useState(false);

  const globalOperator = useAuthStore((s) => s.canWrite)();

  const { data: server, isLoading } = trpc.gameServer.byId.useQuery(
    { id: gameServerId },
    {
      refetchInterval: (query) =>
        TRANSITIONAL_STATUSES.includes(query.state.data?.status ?? "")
          ? STATUS_POLL_MS
          : false,
    },
  );

  const onBack = () =>
    navigate({ to: "/projects/$projectId", params: { projectId } });

  const permissions = useMemo<GameServerPermissionsI | null>(() => {
    if (!server) return null;
    const role = server.projectRole;
    const canOperate = role === "admin" || role === "operator";
    return {
      projectRole: role,
      canOperate,
      isAdmin: role === "admin",
      canViewSecrets: server.canViewSecrets,
      canExecute: canOperate && globalOperator,
    };
  }, [server, globalOperator]);

  const tabs = useMemo(
    () =>
      TABS.filter(
        (t) =>
          (t.id !== "console" || server?.spec.console.method !== "none") &&
          (t.id !== "mods" || Boolean(server?.spec.mods)),
      ),
    [server?.spec.console.method, server?.spec.mods],
  );

  const invalidate = useCallback(() => {
    utils.gameServer.byId.invalidate({ id: gameServerId });
    utils.project.byId.invalidate({ id: projectId });
  }, [utils, gameServerId, projectId]);

  const startMutation = trpc.gameServer.start.useMutation({ onSettled: invalidate });
  const stopMutation = trpc.gameServer.stop.useMutation({ onSettled: invalidate });
  const restartMutation = trpc.gameServer.restart.useMutation({
    onSettled: invalidate,
  });
  const deleteMutation = trpc.gameServer.delete.useMutation({
    onSuccess: () => {
      utils.project.byId.invalidate({ id: projectId });
      onBack();
    },
  });

  const actionError =
    startMutation.error?.message ??
    stopMutation.error?.message ??
    restartMutation.error?.message ??
    null;

  const busy =
    TRANSITIONAL_STATUSES.includes(server?.status ?? "") ||
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending;

  return {
    projectId,
    gameServerId,
    server,
    isLoading,
    permissions,
    tabs,
    activeTab: tabs.some((t) => t.id === activeTab) ? activeTab : "general",
    setActiveTab,
    onBack,
    busy,
    actionError,
    start: () => startMutation.mutate({ id: gameServerId }),
    stop: () => stopMutation.mutate({ id: gameServerId }),
    restart: () => restartMutation.mutate({ id: gameServerId }),
    starting: startMutation.isPending,
    stopping: stopMutation.isPending,
    restarting: restartMutation.isPending,
    showDelete,
    setShowDelete,
    deleteData,
    setDeleteData,
    remove: () => deleteMutation.mutate({ id: gameServerId, deleteData }),
    deleting: deleteMutation.isPending,
    deleteError: deleteMutation.error?.message ?? null,
  };
};
