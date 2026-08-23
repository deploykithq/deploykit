import { useState } from "react";

import { trpc } from "@lib/trpc";

export const useServerCard = () => {
  const utils = trpc.useUtils();
  const [showInstallConfirm, setShowInstallConfirm] = useState(false);

  const healthCheckMutation = trpc.server.healthCheck.useMutation({
    onSuccess: () => utils.server.list.invalidate(),
  });

  const installDockerMutation = trpc.server.installDocker.useMutation({
    onSuccess: () => {
      utils.server.list.invalidate();
      setShowInstallConfirm(false);
    },
  });

  return {
    showInstallConfirm,
    setShowInstallConfirm,
    healthResult: healthCheckMutation.data,
    isChecking: healthCheckMutation.isPending,
    isInstalling: installDockerMutation.isPending,
    installSucceeded: installDockerMutation.isSuccess,
    installResult: installDockerMutation.data,
    runHealthCheck: (id: string) => healthCheckMutation.mutate({ id }),
    installDocker: (id: string) => installDockerMutation.mutate({ id }),
  };
};
