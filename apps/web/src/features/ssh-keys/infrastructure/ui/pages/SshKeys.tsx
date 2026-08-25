import { KeyRound, Plus, X } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { EmptyState } from "@shared/components/empty-state";

import { SshKeyModal, SshKeyRow } from "@ssh-keys/infrastructure/ui/components";

import { useSshKeys } from "@ssh-keys/infrastructure/ui/hooks/useSshKeys";

export const SshKeysPage: React.FC = () => {
  const {
    sshKeys,
    isLoading,
    showAddKey,
    setShowAddKey,
    deleteTarget,
    setDeleteTarget,
    deleteError,
    dismissDeleteError,
    deleting,
    handleKeyCreated,
    handleConfirmDelete,
  } = useSshKeys();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">SSH Keys</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Keys DeployKit uses to reach your remote servers
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAddKey(true)}>
          <Plus className="w-3.5 h-3.5" />
          Add SSH Key
        </Button>
      </div>

      {deleteError && (
        <Card>
          <div className="flex items-start gap-3">
            <p className="flex-1 text-xs text-danger">{deleteError}</p>
            <button
              type="button"
              onClick={dismissDeleteError}
              className="text-text-muted hover:text-text-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </Card>
      )}

      {/* Key list */}
      {isLoading ? (
        <div className="text-sm text-text-muted p-6">Loading...</div>
      ) : !sshKeys?.length ? (
        <Card>
          <EmptyState
            icon={<KeyRound className="w-5 h-5" />}
            title="No SSH keys yet"
            description="Generate a key here, add its public half to your server's authorized_keys, then attach it when you add the server."
            action={
              <Button size="sm" onClick={() => setShowAddKey(true)}>
                <Plus className="w-3.5 h-3.5" />
                Add SSH Key
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {sshKeys.map((sshKey) => (
            <SshKeyRow
              key={sshKey.id}
              sshKey={sshKey}
              onDelete={() =>
                setDeleteTarget({ id: sshKey.id, name: sshKey.name })
              }
            />
          ))}
        </div>
      )}

      {/* Add Key Modal */}
      <SshKeyModal
        open={showAddKey}
        onClose={() => setShowAddKey(false)}
        onCreated={handleKeyCreated}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete SSH Key"
        description={`Permanently delete "${deleteTarget?.name}"? The private key cannot be recovered.`}
        confirmText="Delete Key"
        isPending={deleting}
      />
    </div>
  );
};
