import { useState } from "react";

import { trpc } from "@lib/trpc";

type ModKeyNameT = "curseforge_api_key" | "steam_web_api_key";

/** Admin: the CurseForge / Steam keys that mod search and installs use. */
export const useGameModKeys = () => {
  const utils = trpc.useUtils();
  const statusQuery = trpc.settings.modKeys.status.useQuery();
  const [drafts, setDrafts] = useState<Record<ModKeyNameT, string>>({
    curseforge_api_key: "",
    steam_web_api_key: "",
  });
  const [savedKey, setSavedKey] = useState<ModKeyNameT | null>(null);

  const setMutation = trpc.settings.modKeys.set.useMutation({
    onMutate: () => setSavedKey(null),
    onSuccess: (_data, vars) => {
      setDrafts((d) => ({ ...d, [vars.key]: "" }));
      setSavedKey(vars.key);
      utils.settings.modKeys.status.invalidate();
      // Which catalogues can search depends on these keys.
      utils.gameServer.mods.invalidate();
    },
  });

  return {
    status: statusQuery.data,
    loading: statusQuery.isLoading,
    drafts,
    setDraft: (key: ModKeyNameT, value: string) => setDrafts((d) => ({ ...d, [key]: value })),
    save: (key: ModKeyNameT) => setMutation.mutate({ key, value: drafts[key].trim() }),
    clear: (key: ModKeyNameT) => setMutation.mutate({ key, value: null }),
    pendingKey: setMutation.isPending ? (setMutation.variables?.key ?? null) : null,
    errorKey: setMutation.error ? (setMutation.variables?.key ?? null) : null,
    error: setMutation.error?.message ?? null,
    savedKey,
  };
};
