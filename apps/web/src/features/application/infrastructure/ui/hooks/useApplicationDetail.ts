import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { appDetailRoute } from "@/router";

import { trpc } from "@lib/trpc";

import { useApplicationActions } from "@application/infrastructure/ui/hooks/useApplicationActions";

import { DEPLOYING_REFETCH_MS } from "@application/infrastructure/ui/constants/application.constants";

import type { TabT } from "@application/infrastructure/ui/interfaces/application.interfaces";

export const useApplicationDetail = () => {
  const { projectId, appId: applicationId } = appDetailRoute.useParams();
  const navigate = useNavigate();
  const onBack = () =>
    navigate({ to: "/projects/$projectId", params: { projectId } });

  const [activeTab, setActiveTab] = useState<TabT>("general");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [branchInput, setBranchInput] = useState("");

  const { data: app, isLoading } = trpc.application.byId.useQuery(
    { id: applicationId },
    {
      // Mientras construye o despliega se sondea; el resto del tiempo, no.
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "building" || status === "deploying")
          return DEPLOYING_REFETCH_MS;
        return false;
      },
    },
  );

  // El rol por proyecto lo resuelve el servidor y llega en la propia app.
  const projectRole = (app as any)?.projectRole as string | undefined;
  const canOperate = projectRole === "admin" || projectRole === "operator";

  const { deployMutation, startMutation, stopMutation, deleteMutation } =
    useApplicationActions({ applicationId, onBack, setActiveTab });

  const utils = trpc.useUtils();
  const deployBranchMutation = trpc.application.deployBranch.useMutation({
    onSuccess: () => {
      utils.application.byId.invalidate({ id: applicationId });
      utils.application.deployments.invalidate({ id: applicationId });
      setShowBranchModal(false);
      setBranchInput("");
      setActiveTab("deployments");
    },
  });

  return {
    applicationId,
    app,
    isLoading,
    onBack,
    canOperate,
    activeTab,
    setActiveTab,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showBranchModal,
    setShowBranchModal,
    branchInput,
    setBranchInput,
    deployMutation,
    startMutation,
    stopMutation,
    deleteMutation,
    deployBranchMutation,
  };
};
