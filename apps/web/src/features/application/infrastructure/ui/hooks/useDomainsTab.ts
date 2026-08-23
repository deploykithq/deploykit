import { useState } from "react";

import { trpc } from "@lib/trpc";

export const useDomainsTab = (app: any, applicationId: string) => {
  const utils = trpc.useUtils();

  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [newDomain, setNewDomain] = useState<string>("");
  const [newPort, setNewPort] = useState<string>(String(app.port || 3000));

  const addMutation = trpc.application.addDomain.useMutation({
    onSuccess: () => {
      utils.application.byId.invalidate({ id: applicationId });
      setShowAdd(false);
      setNewDomain("");
    },
  });

  const removeMutation = trpc.application.removeDomain.useMutation({
    onSuccess: () => utils.application.byId.invalidate({ id: applicationId }),
  });

  return {
    showAdd,
    setShowAdd,
    newDomain,
    setNewDomain,
    newPort,
    setNewPort,
    adding: addMutation.isPending,
    addError: addMutation.error,
    addDomain: addMutation.mutate,
    removeDomain: removeMutation.mutate,
  };
};
