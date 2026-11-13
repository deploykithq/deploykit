import { useState } from "react";

import { trpc } from "@lib/trpc";

type ApiTokenScopeT = "read" | "write";

/** `""` means the token never expires. */
type ExpiryT = "" | "30" | "90" | "365";

interface ApiTokenDraftI {
  name: string;
  scope: ApiTokenScopeT;
  expiry: ExpiryT;
}

const EMPTY_DRAFT: ApiTokenDraftI = { name: "", scope: "read", expiry: "90" };

/** The signed-in user's own API tokens: list, create, revoke. */
export const useApiTokens = () => {
  const utils = trpc.useUtils();
  const listQuery = trpc.apiToken.list.useQuery();
  const [draft, setDraft] = useState<ApiTokenDraftI>(EMPTY_DRAFT);
  // The token value exists only in this state, between creation and "Done".
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const createMutation = trpc.apiToken.create.useMutation({
    onSuccess: (data) => {
      setRevealed({ name: data.name, token: data.token });
      setDraft(EMPTY_DRAFT);
      utils.apiToken.list.invalidate();
    },
  });

  const revokeMutation = trpc.apiToken.revoke.useMutation({
    onSuccess: () => {
      setRevokeId(null);
      utils.apiToken.list.invalidate();
    },
  });

  const tokens = listQuery.data ?? [];

  return {
    tokens,
    loading: listQuery.isLoading,
    draft,
    setDraft: (patch: Partial<ApiTokenDraftI>) => setDraft((d) => ({ ...d, ...patch })),
    canCreate: draft.name.trim().length > 0 && !createMutation.isPending,
    creating: createMutation.isPending,
    create: () =>
      createMutation.mutate({
        name: draft.name.trim(),
        scope: draft.scope,
        expiresInDays: draft.expiry === "" ? null : Number(draft.expiry),
      }),
    createError: createMutation.error?.message ?? null,
    revealed,
    dismissRevealed: () => setRevealed(null),
    revokeTarget: tokens.find((t) => t.id === revokeId) ?? null,
    askRevoke: (id: string) => setRevokeId(id),
    cancelRevoke: () => setRevokeId(null),
    confirmRevoke: () => revokeId && revokeMutation.mutate({ id: revokeId }),
    revoking: revokeMutation.isPending,
    revokeError: revokeMutation.error?.message ?? null,
  };
};

export type { ApiTokenScopeT, ExpiryT };
