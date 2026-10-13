import { useEffect, useMemo, useState } from "react";

import { trpc } from "@lib/trpc";

import { STATUS_POLL_MS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type {
  GameServerDetailT,
  ModpackChoiceI,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** The Mods tab: the list, updates, toggles, the modpack and applying changes. */
export const useGameMods = (server: GameServerDetailT) => {
  const utils = trpc.useUtils();
  const id = server.id;
  const [addOpen, setAddOpen] = useState(false);
  const [modpackOpen, setModpackOpen] = useState(false);
  const [safetyBackup, setSafetyBackup] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // An apply runs in the background (safety backup, then rebuild): poll
  // until the list no longer reports pending changes.
  const [awaitingApply, setAwaitingApply] = useState(false);

  const listQuery = trpc.gameServer.mods.list.useQuery(
    { id },
    { refetchInterval: awaitingApply ? STATUS_POLL_MS : false },
  );

  useEffect(() => {
    if (!awaitingApply) return;
    // Done — or failed: the reason then shows next to the server's status.
    // Done — or refused/failed: the reason then shows as the status message.
    if (
      (listQuery.data && !listQuery.data.pending) ||
      server.status === "error" ||
      server.statusMessage
    ) {
      setAwaitingApply(false);
    }
  }, [awaitingApply, listQuery.data, server.status, server.statusMessage]);

  const sourcesQuery = trpc.gameServer.mods.sources.useQuery({ id });
  // Asks every catalogue about every mod: only on demand.
  const updatesQuery = trpc.gameServer.mods.checkUpdates.useQuery(
    { id },
    { enabled: false, retry: false },
  );

  const invalidate = () => {
    utils.gameServer.mods.list.invalidate({ id });
    utils.gameServer.byId.invalidate({ id });
  };

  const updateMutation = trpc.gameServer.mods.update.useMutation({
    onSettled: () => {
      setBusyId(null);
      invalidate();
      if (updatesQuery.data) updatesQuery.refetch();
    },
  });
  const removeMutation = trpc.gameServer.mods.remove.useMutation({
    onSettled: () => {
      setBusyId(null);
      invalidate();
    },
  });
  const modpackMutation = trpc.gameServer.mods.setModpack.useMutation({
    onSuccess: () => setModpackOpen(false),
    onSettled: invalidate,
  });
  const applyMutation = trpc.gameServer.mods.applyChanges.useMutation({
    onSuccess: (result) => setAwaitingApply(result.queued),
    onSettled: () => {
      invalidate();
      utils.gameServer.backups.list.invalidate({ id });
    },
  });

  const updates = useMemo(
    () => new Map((updatesQuery.data ?? []).map((u) => [u.modId, u])),
    [updatesQuery.data],
  );
  const sources = sourcesQuery.data ?? [];

  return {
    data: listQuery.data,
    loading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    sources,
    hasModpackSources: sources.some((s) => s.modpacks),
    canEdit: listQuery.data?.canEdit ?? false,
    updates,
    updatesChecked: updatesQuery.isSuccess,
    checkingUpdates: updatesQuery.isFetching,
    updatesError: updatesQuery.error?.message ?? null,
    checkUpdates: () => updatesQuery.refetch(),
    busyId,
    toggle: (modId: string, enabled: boolean) => {
      setBusyId(modId);
      updateMutation.mutate({ id, modId, enabled });
    },
    updateTo: (modId: string, versionId: string) => {
      setBusyId(modId);
      updateMutation.mutate({ id, modId, versionId });
    },
    remove: (modId: string) => {
      setBusyId(modId);
      removeMutation.mutate({ id, modId });
    },
    mutationError:
      updateMutation.error?.message ??
      removeMutation.error?.message ??
      modpackMutation.error?.message ??
      null,
    addOpen,
    setAddOpen,
    modpackOpen,
    setModpackOpen,
    setModpack: (pick: Omit<ModpackChoiceI, "name"> | null) =>
      modpackMutation.mutate({ id, modpack: pick }),
    settingModpack: modpackMutation.isPending,
    safetyBackup,
    setSafetyBackup,
    apply: () => applyMutation.mutate({ id, safetyBackup }),
    applying: applyMutation.isPending || awaitingApply,
    applyError: applyMutation.error?.message ?? null,
    applied: applyMutation.data ?? null,
  };
};
