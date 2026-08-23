import { useMemo, useState } from "react";

import { useDeployLogs } from "@lib/socket";
import { trpc } from "@lib/trpc";

export const useDeploymentsTab = (applicationId: string) => {
  const utils = trpc.useUtils();

  const { data: app } = trpc.application.byId.useQuery({ id: applicationId });
  const { data: deploymentsList } = trpc.application.deployments.useQuery({
    id: applicationId,
  });

  const [selectedDeployId, setSelectedDeployId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);

  const { logs: liveLogs, status: liveStatus } = useDeployLogs(selectedDeployId);

  const rollbackMutation = trpc.application.rollback.useMutation({
    onSuccess: (newDeploy) => {
      utils.application.byId.invalidate({ id: applicationId });
      utils.application.deployments.invalidate({ id: applicationId });
      setRollbackTarget(null);
      setSelectedDeployId(newDeploy.id);
    },
    onError: (err) => {
      utils.application.byId.invalidate({ id: applicationId });
      utils.application.deployments.invalidate({ id: applicationId });
      setRollbackTarget(null);
      alert(`Rollback failed: ${err.message}`);
    },
  });

  const currentDeployId = useMemo(
    () => deploymentsList?.find((d) => d.status === "success")?.id,
    [deploymentsList],
  );

  return {
    app,
    deploymentsList,
    selectedDeployId,
    setSelectedDeployId,
    rollbackTarget,
    setRollbackTarget,
    liveLogs,
    liveStatus,
    currentDeployId,
    rollingBack: rollbackMutation.isPending,
    rollback: (deploymentId: string) =>
      rollbackMutation.mutate({ applicationId, deploymentId }),
  };
};
