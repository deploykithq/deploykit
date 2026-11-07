import { useState } from "react";

import { trpc } from "@lib/trpc";

import type { GameServerDetailT } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** A check asks the catalogue and the image registry: not on every render. */
const IMAGE_CHECK_STALE_MS = 5 * 60_000;

/**
 * "Update image": whether the game has a newer image for this server (a new
 * tag in the catalogue, or a new build of the same tag) and the update.
 */
export const useImageUpdate = (server: GameServerDetailT) => {
  const utils = trpc.useUtils();
  const check = trpc.gameServer.image.check.useQuery(
    { id: server.id },
    { staleTime: IMAGE_CHECK_STALE_MS, retry: false, refetchOnWindowFocus: false },
  );
  const [open, setOpen] = useState(false);
  const [safetyBackup, setSafetyBackup] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const mutation = trpc.gameServer.image.update.useMutation({
    onSuccess: (result) => {
      utils.gameServer.byId.invalidate({ id: server.id });
      utils.gameServer.backups.list.invalidate({ id: server.id });
      utils.gameServer.image.check.invalidate({ id: server.id });
      setOpen(false);
      setNote(
        result.appliesOnStart
          ? "Saved: the first start uses the new image."
          : "Queued: the new image is pulled, then the container is recreated with it.",
      );
    },
  });

  return {
    data: check.data ?? null,
    loading: check.isLoading,
    checkError: check.error?.message ?? null,
    recheck: () => check.refetch(),
    rechecking: check.isFetching,
    open,
    setOpen,
    safetyBackup,
    setSafetyBackup,
    update: () => mutation.mutate({ id: server.id, safetyBackup }),
    pending: mutation.isPending,
    error: mutation.error?.message ?? null,
    note,
  };
};
