import { memo } from "react";
import { Download, KeyRound, ShieldAlert } from "lucide-react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Textarea } from "@shared/components/textarea";

import { useSshKeyForm } from "@ssh-keys/infrastructure/ui/hooks/useSshKeyForm";

import type { SshKeyModalPropsI } from "@ssh-keys/infrastructure/ui/interfaces/ssh-keys.interfaces";

export const SshKeyModal: React.FC<SshKeyModalPropsI> = memo(
  function SshKeyModal({ open, onClose, onCreated }) {
    const {
      name,
      setName,
      description,
      setDescription,
      privateKey,
      setPrivateKey,
      publicKey,
      setPublicKey,
      generating,
      creating,
      error,
      handleGenerate,
      handleSubmit,
      downloadPrivate,
      downloadPublic,
    } = useSshKeyForm(onCreated);

    return (
      <Modal open={open} onClose={onClose} title="SSH Key">
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-text-secondary -mt-2">
            Add one of your keys or generate a new one.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleGenerate("rsa")}
              disabled={generating}
            >
              <KeyRound className="w-3.5 h-3.5" />
              Generate RSA SSH Key
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleGenerate("ed25519")}
              disabled={generating}
            >
              <KeyRound className="w-3.5 h-3.5" />
              Generate ED25519 SSH Key
            </Button>
          </div>

          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Personal projects"
            required
          />

          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Used on my personal Hetzner VPS"
          />

          <Textarea
            label="Private Key"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            rows={6}
            className="font-mono text-xs"
            required
          />

          <Input
            label="Public Key"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5"
            className="font-mono text-xs"
          />

          <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-2 border border-border">
            <ShieldAlert className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
            <p className="text-xs text-text-muted">
              This is the only time the private key is shown. It is encrypted
              before being stored and never displayed again — download it now if
              you want a backup. Copy the <strong>public</strong> key to your
              server&apos;s <code>~/.ssh/authorized_keys</code>. Keys protected
              with a passphrase are not supported.
            </p>
          </div>

          {error && <p className="text-xs text-danger">{error.message}</p>}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {privateKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={downloadPrivate}
              >
                <Download className="w-3.5 h-3.5" />
                Private Key
              </Button>
            )}
            {publicKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={downloadPublic}
              >
                <Download className="w-3.5 h-3.5" />
                Public Key
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating || generating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
