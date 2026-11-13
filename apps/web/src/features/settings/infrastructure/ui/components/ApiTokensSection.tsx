import { memo, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import { Button } from "@shared/components/button";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { Input } from "@shared/components/input";
import { Select } from "@shared/components/select";

import { SectionCard } from "@settings/infrastructure/ui/components/SectionCard";
import { useApiTokens } from "@settings/infrastructure/ui/hooks/useApiTokens";

import type {
  ApiTokenScopeT,
  ExpiryT,
} from "@settings/infrastructure/ui/hooks/useApiTokens";

const SCOPE_OPTIONS = [
  { value: "read", label: "Read only" },
  { value: "write", label: "Read and write" },
];

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "", label: "Never" },
];

const formatDate = (value: string | Date | null): string =>
  value ? new Date(value).toLocaleDateString() : "—";

const isPast = (value: string | Date | null): boolean =>
  value !== null && new Date(value).getTime() <= Date.now();

/**
 * API tokens let a script or an AI agent (the DeployKit MCP server) act as
 * this user without their password. A token is shown once, at creation.
 */
export const ApiTokensSection: React.FC = memo(function ApiTokensSection() {
  const t = useApiTokens();
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = (token: string) => {
    navigator.clipboard?.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SectionCard icon={KeyRound} title="API tokens">
      <div className="space-y-5">
        <p className="text-xs text-text-muted">
          A token acts as you, with your roles, from scripts and AI agents. A read-only
          token cannot change anything. No token can change your password, manage users or
          create other tokens.
        </p>

        {t.revealed && (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 space-y-2">
            <p className="text-sm font-medium">
              Copy the token for “{t.revealed.name}” now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-1.5 rounded bg-surface-2 border border-border text-xs font-mono break-all">
                {t.revealed.token}
              </code>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => handleCopy(t.revealed!.token)}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={t.dismissRevealed}>
                Done
              </Button>
            </div>
          </div>
        )}

        <form
          className="grid gap-3 grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (t.canCreate) t.create();
          }}
        >
          <Input
            label="Name"
            value={t.draft.name}
            onChange={(e) => t.setDraft({ name: e.target.value })}
            placeholder="e.g. Claude Code on my laptop"
            maxLength={100}
          />
          <Select
            label="Access"
            options={SCOPE_OPTIONS}
            value={t.draft.scope}
            onChange={(e) => t.setDraft({ scope: e.target.value as ApiTokenScopeT })}
          />
          <Select
            label="Expires"
            options={EXPIRY_OPTIONS}
            value={t.draft.expiry}
            onChange={(e) => t.setDraft({ expiry: e.target.value as ExpiryT })}
          />
          <Button type="submit" disabled={!t.canCreate}>
            {t.creating ? "Creating…" : "Create token"}
          </Button>
        </form>
        {t.createError && <p className="text-xs text-danger">{t.createError}</p>}

        {t.loading ? (
          <p className="text-xs text-text-muted">Loading…</p>
        ) : t.tokens.length === 0 ? (
          <p className="text-xs text-text-muted">You have no API tokens.</p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg">
            {t.tokens.map((token) => (
              <li
                key={token.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{token.name}</p>
                  <p className="text-xs text-text-muted">
                    <code className="font-mono">{token.tokenPrefix}…</code>
                    {" · "}
                    {token.scope === "write" ? "Read and write" : "Read only"}
                    {" · "}
                    {token.expiresAt === null
                      ? "Never expires"
                      : isPast(token.expiresAt)
                        ? `Expired ${formatDate(token.expiresAt)}`
                        : `Expires ${formatDate(token.expiresAt)}`}
                    {" · "}
                    {token.lastUsedAt
                      ? `Last used ${formatDate(token.lastUsedAt)}`
                      : "Never used"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => t.askRevoke(token.id)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        {t.revokeError && <p className="text-xs text-danger">{t.revokeError}</p>}
      </div>

      <ConfirmDialog
        open={t.revokeTarget !== null}
        onClose={t.cancelRevoke}
        onConfirm={t.confirmRevoke}
        title="Revoke API token"
        description={`“${t.revokeTarget?.name ?? ""}” will stop working immediately. This cannot be undone.`}
        confirmText="Revoke"
        isPending={t.revoking}
      />
    </SectionCard>
  );
});
