import { Layers, Monitor, Plus, Server } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { EmptyState } from "@shared/components/empty-state";

import {
  AddServerModal,
  ImageCleanupPanel,
  ServerCard,
} from "@server/infrastructure/ui/components";

import { useServers } from "@server/infrastructure/ui/hooks/useServers";

export const ServersPage: React.FC = () => {
  const {
    servers,
    isLoading,
    isAdmin,
    hasLocal,
    showAddServer,
    setShowAddServer,
    showCleanup,
    setShowCleanup,
    deleteTarget,
    setDeleteTarget,
    creatingLocal,
    createLocalServer,
    deleting,
    handleServerCreated,
    handleConfirmDelete,
  } = useServers();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Servers</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Manage servers where your applications are deployed
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {!hasLocal && (
              <Button
                variant="secondary"
                size="sm"
                onClick={createLocalServer}
                disabled={creatingLocal}
              >
                <Monitor className="w-3.5 h-3.5" />
                {creatingLocal ? "Adding..." : "Add Local Server"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCleanup(true)}
            >
              <Layers className="w-3.5 h-3.5" />
              Clean images
            </Button>
            <Button size="sm" onClick={() => setShowAddServer(true)}>
              <Plus className="w-3.5 h-3.5" />
              Add Server
            </Button>
          </div>
        )}
      </div>

      {/* Server List */}
      {isLoading ? (
        <div className="text-sm text-text-muted p-6">Loading...</div>
      ) : !servers?.length ? (
        <Card>
          <EmptyState
            icon={<Server className="w-5 h-5" />}
            title="No servers configured"
            description="Add your local Docker engine or a remote server to start deploying applications."
            action={
              isAdmin ? (
                <Button
                  size="sm"
                  onClick={createLocalServer}
                  disabled={creatingLocal}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Add Local Server
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              isAdmin={isAdmin}
              onDelete={() =>
                setDeleteTarget({ id: server.id, name: server.name })
              }
            />
          ))}
        </div>
      )}

      {/* Add Server Modal */}
      <AddServerModal
        open={showAddServer}
        onClose={() => setShowAddServer(false)}
        onCreated={handleServerCreated}
      />

      {/* Image Cleanup Panel */}
      {isAdmin && (
        <ImageCleanupPanel
          open={showCleanup}
          onClose={() => setShowCleanup(false)}
        />
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Server"
        description={`Remove "${deleteTarget?.name}" from DeployKit? This won't affect running containers on the server.`}
        confirmText="Remove Server"
        isPending={deleting}
      />
    </div>
  );
};
