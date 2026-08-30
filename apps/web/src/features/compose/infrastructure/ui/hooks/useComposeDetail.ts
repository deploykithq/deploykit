import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

import { composeDetailRoute } from "@/router";

import { trpc } from "@lib/trpc";

import {
  DEPLOYING_REFETCH_MS,
  CONTAINERS_REFETCH_MS,
} from "@compose/infrastructure/ui/constants/compose.constants";

import type {
  ComposeTabT,
  ComposeContainerI,
} from "@compose/infrastructure/ui/interfaces/compose.interfaces";

export const useComposeDetail = () => {
  const { projectId, composeId } = composeDetailRoute.useParams();
  const navigate = useNavigate();
  const onBack = () =>
    navigate({ to: "/projects/$projectId", params: { projectId } });

  const [activeTab, setActiveTab] = useState<ComposeTabT>("general");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    null,
  );

  const utils = trpc.useUtils();

  const { data: stack, isLoading } = trpc.compose.byId.useQuery(
    { id: composeId },
    {
      refetchInterval: (query) =>
        query.state.data?.status === "deploying" ? DEPLOYING_REFETCH_MS : false,
    },
  );

  // Compose recreates containers on every `up`, so ids change under us — poll
  // rather than caching them for the lifetime of the page.
  const { data: containers } = trpc.compose.containers.useQuery(
    { id: composeId },
    { refetchInterval: CONTAINERS_REFETCH_MS },
  );

  const containerList = useMemo<ComposeContainerI[]>(
    () => containers ?? [],
    [containers],
  );

  // Default to the first running container, and re-pick when the selected one
  // disappears (a redeploy replaces every id).
  useEffect(() => {
    if (containerList.length === 0) {
      if (selectedContainerId !== null) setSelectedContainerId(null);
      return;
    }
    const stillThere = containerList.some((c) => c.id === selectedContainerId);
    if (!stillThere) {
      const running = containerList.find((c) => c.state === "running");
      setSelectedContainerId((running ?? containerList[0]!).id);
    }
  }, [containerList, selectedContainerId]);

  const projectRole = (stack as any)?.projectRole as string | undefined;
  const canOperate = projectRole === "admin" || projectRole === "operator";
  const canDelete = projectRole === "admin";

  const invalidate = () => {
    utils.compose.byId.invalidate({ id: composeId });
    utils.compose.containers.invalidate({ id: composeId });
  };

  const deployMutation = trpc.compose.deploy.useMutation({
    onSuccess: () => {
      invalidate();
      utils.compose.deployments.invalidate({ id: composeId });
      setActiveTab("deployments");
    },
  });

  const startMutation = trpc.compose.start.useMutation({ onSuccess: invalidate });
  const stopMutation = trpc.compose.stop.useMutation({ onSuccess: invalidate });
  const restartMutation = trpc.compose.restart.useMutation({
    onSuccess: invalidate,
  });

  const deleteMutation = trpc.compose.delete.useMutation({
    onSuccess: () => {
      utils.compose.list.invalidate();
      onBack();
    },
  });

  return {
    projectId,
    composeId,
    stack,
    isLoading,
    onBack,
    canOperate,
    canDelete,
    activeTab,
    setActiveTab,
    showDeleteConfirm,
    setShowDeleteConfirm,
    containers: containerList,
    selectedContainerId,
    setSelectedContainerId,
    deployMutation,
    startMutation,
    stopMutation,
    restartMutation,
    deleteMutation,
  };
};
