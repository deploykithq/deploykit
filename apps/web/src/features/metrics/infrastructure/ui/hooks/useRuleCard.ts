import { useState } from "react";

import { trpc } from "@lib/trpc";

export const useRuleCard = () => {
  const utils = trpc.useUtils();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const toggleMutation = trpc.metrics.updateRule.useMutation({
    onSuccess: () => utils.metrics.listRules.invalidate(),
  });

  const deleteMutation = trpc.metrics.deleteRule.useMutation({
    onSuccess: () => {
      utils.metrics.listRules.invalidate();
      utils.metrics.alertStats.invalidate();
    },
  });

  return {
    deleteOpen,
    setDeleteOpen,
    deleting: deleteMutation.isPending,
    toggleRule: (id: string, enabled: boolean) =>
      toggleMutation.mutate({ id, enabled }),
    deleteRule: (id: string) => deleteMutation.mutate({ id }),
  };
};
