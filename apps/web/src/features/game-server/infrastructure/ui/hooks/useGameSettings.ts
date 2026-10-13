import { useState } from "react";

import { trpc } from "@lib/trpc";

import { useGameForm } from "@game-server/infrastructure/ui/hooks/useGameForm";

import { SAVED_FEEDBACK_MS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type { GameServerDetailT } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** The Settings tab: the create form in update mode, against the saved server. */
export const useGameSettings = (server: GameServerDetailT) => {
  const utils = trpc.useUtils();
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const form = useGameForm({
    spec: server.spec,
    mode: "update",
    currentValues: server.values,
    currentPorts: server.ports,
    currentMemoryMb: server.memoryMb,
  });

  const updateMutation = trpc.gameServer.update.useMutation({
    onSuccess: (result) => {
      utils.gameServer.byId.invalidate({ id: server.id });
      utils.project.byId.invalidate({ id: server.projectId });
      setSavedNote(result.restarted ? "Saved — the server is restarting" : "Saved");
      setTimeout(() => setSavedNote(null), SAVED_FEEDBACK_MS);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = form.buildPayload();
    if (!payload) return;
    updateMutation.mutate({
      id: server.id,
      values: payload.values,
      // Unchanged ports are left out so the API does not re-check them.
      ...(form.portsChanged() ? { ports: payload.ports } : {}),
      memoryMb: payload.memoryMb,
    });
  };

  return {
    form,
    handleSubmit,
    saving: updateMutation.isPending,
    error: updateMutation.error?.message ?? null,
    savedNote,
  };
};
