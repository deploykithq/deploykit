import { useState } from "react";

import { trpc } from "@lib/trpc";

import type { SessionEntryI } from "@sessions/infrastructure/ui/interfaces/sessions.interfaces";

export const useRevokeSession = () => {
  const utils = trpc.useUtils();
  const [revokeTarget, setRevokeTarget] = useState<SessionEntryI | null>(null);

  const revokeMutation = trpc.session.revoke.useMutation({
    onSuccess: () => {
      // Las stats también cambian: la sesión deja de contar como activa.
      utils.session.list.invalidate();
      utils.session.stats.invalidate();
      setRevokeTarget(null);
    },
  });

  const handleRevokeConfirm = () => {
    if (revokeTarget) revokeMutation.mutate({ id: revokeTarget.id });
  };

  return {
    revokeTarget,
    setRevokeTarget,
    handleRevokeConfirm,
    isRevoking: revokeMutation.isPending,
  };
};
