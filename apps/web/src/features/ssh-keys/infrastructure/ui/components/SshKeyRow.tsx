import { memo, useState } from "react";
import { Check, Copy, KeyRound, Server, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import {
  TYPE_BADGE,
  TYPE_LABEL,
} from "@ssh-keys/infrastructure/ui/constants/ssh-keys.constants";

import type { SshKeyRowPropsI } from "@ssh-keys/infrastructure/ui/interfaces/ssh-keys.interfaces";

export const SshKeyRow: React.FC<SshKeyRowPropsI> = memo(function SshKeyRow({
  sshKey,
  onDelete,
}) {
  const [copied, setCopied] = useState(false);
  const inUse = sshKey.servers.length > 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(sshKey.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
          <KeyRound className="w-4 h-4 text-text-secondary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{sshKey.name}</span>
            <span
              className={`text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${
                TYPE_BADGE[sshKey.type] ?? "bg-surface-3 text-text-muted"
              }`}
            >
              {TYPE_LABEL[sshKey.type] ?? sshKey.type}
            </span>
          </div>

          {sshKey.description && (
            <p className="text-xs text-text-secondary mt-0.5">
              {sshKey.description}
            </p>
          )}

          <p className="text-xs text-text-muted font-mono truncate mt-1">
            {sshKey.fingerprint}
          </p>

          {inUse && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-text-muted">
              <Server className="w-3 h-3" />
              <span>{sshKey.servers.map((s) => s.name).join(", ")}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            title="Copy public key"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={inUse}
            title={
              inUse ? "In use by a server — detach it first" : "Delete key"
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
});
