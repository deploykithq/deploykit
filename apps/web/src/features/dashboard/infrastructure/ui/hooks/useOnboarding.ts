import { useNavigate } from "@tanstack/react-router";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

export const useOnboarding = () => {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");

  const createLocal = trpc.server.createLocal.useMutation({
    onSuccess: () => utils.dashboard.summary.invalidate(),
    onError: (err) => alert(err.message),
  });

  return {
    isAdmin,
    navigate,
    connectingLocal: createLocal.isPending,
    connectLocalServer: () => createLocal.mutate(),
  };
};
