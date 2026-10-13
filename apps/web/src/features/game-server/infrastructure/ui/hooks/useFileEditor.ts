import { useEffect, useState } from "react";

import { trpc } from "@lib/trpc";

import { SAVED_FEEDBACK_MS } from "@game-server/infrastructure/ui/constants/game-server.constants";

/** Load one text file into the editor and save it back. */
export const useFileEditor = (gameServerId: string, volume: string, path: string) => {
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  const readQuery = trpc.gameServer.files.read.useQuery(
    { id: gameServerId, volume, path },
    // Always reload when opened: someone (or the game) may have changed it.
    { refetchOnWindowFocus: false, staleTime: 0, gcTime: 0 },
  );

  useEffect(() => {
    if (typeof readQuery.data?.content === "string") setText(readQuery.data.content);
  }, [readQuery.data?.content]);

  const writeMutation = trpc.gameServer.files.write.useMutation({
    onSuccess: () => {
      utils.gameServer.files.read.invalidate({ id: gameServerId, volume, path });
      utils.gameServer.files.list.invalidate({ id: gameServerId, volume });
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    },
  });

  return {
    text,
    setText,
    loading: readQuery.isLoading,
    loadError: readQuery.error?.message ?? null,
    dirty: readQuery.data !== undefined && text !== readQuery.data.content,
    save: () => writeMutation.mutate({ id: gameServerId, volume, path, content: text }),
    saving: writeMutation.isPending,
    saveError: writeMutation.error?.message ?? null,
    saved,
  };
};
