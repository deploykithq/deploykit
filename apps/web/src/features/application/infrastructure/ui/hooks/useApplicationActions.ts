import { useCallback } from "react";
import { trpc } from "@lib/trpc";

import type { TabT } from "@application/infrastructure/ui/interfaces/application.interfaces";

export interface MutationHandleI {
  mutate: (input: any) => void;
  isPending: boolean;
}

export interface UseApplicationActionsReturnI {
  deployMutation: MutationHandleI;
  startMutation: MutationHandleI;
  stopMutation: MutationHandleI;
  deleteMutation: MutationHandleI;
}

interface UseApplicationActionsOptsI {
  applicationId: string;
  onBack: () => void;
  setActiveTab: (tab: TabT) => void;
}

export const useApplicationActions = ({
  applicationId,
  onBack,
  setActiveTab,
}: UseApplicationActionsOptsI): UseApplicationActionsReturnI => {
  const utils = trpc.useUtils();

  const invalidate = useCallback(
    () => utils.application.byId.invalidate({ id: applicationId }),
    [utils, applicationId],
  );

  const deploy = trpc.application.deploy.useMutation({
    onSuccess: () => {
      invalidate();
      setActiveTab("deployments");
    },
  });

  const start = trpc.application.start.useMutation({ onSuccess: invalidate });
  const stop = trpc.application.stop.useMutation({ onSuccess: invalidate });
  const del = trpc.application.delete.useMutation({
    onSuccess: () => onBack(),
  });

  // Wrap each mutate in a plain arrow function so TypeScript resolves
  // the return type to MutationHandle without leaking UseTRPCMutationResult.
  const deployMutation: MutationHandleI = {
    mutate: useCallback((input) => deploy.mutate(input), [deploy]),
    isPending: deploy.isPending,
  };
  const startMutation: MutationHandleI = {
    mutate: useCallback((input) => start.mutate(input), [start]),
    isPending: start.isPending,
  };
  const stopMutation: MutationHandleI = {
    mutate: useCallback((input) => stop.mutate(input), [stop]),
    isPending: stop.isPending,
  };
  const deleteMutation: MutationHandleI = {
    mutate: useCallback((input) => del.mutate(input), [del]),
    isPending: del.isPending,
  };

  return { deployMutation, startMutation, stopMutation, deleteMutation };
};
