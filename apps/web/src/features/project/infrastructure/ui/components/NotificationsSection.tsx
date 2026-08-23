import { memo } from "react";
import { Bell, Plus } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { EmptyState } from "@shared/components/empty-state";

import {
  NotificationChannelCard,
  NotificationChannelModal,
} from "@project/infrastructure/ui/components";

import { useProjectNotifications } from "@project/infrastructure/ui/hooks/useProjectNotifications";

interface NotificationsSectionPropsI {
  projectId: string;
}

export const NotificationsSection: React.FC<NotificationsSectionPropsI> = memo(
  function NotificationsSection({ projectId }) {
    const {
      showModal,
      setShowModal,
      editChannel,
      setEditChannel,
      canWrite,
      channels,
      isLoading,
      handleEdit,
      handleClose,
    } = useProjectNotifications(projectId);

    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Notifications
          </h2>
          {canWrite && channels.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditChannel(null);
                setShowModal(true);
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Channel
            </Button>
          )}
        </div>

        {isLoading ? (
          <p className="text-xs text-text-muted">Loading…</p>
        ) : channels.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Bell className="w-6 h-6" />}
              title="No notification channels"
              description="Add a channel to receive alerts on deploy, failures, and more."
              action={
                canWrite ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditChannel(null);
                      setShowModal(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Channel
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {channels.map((channel) => (
              <NotificationChannelCard
                key={channel.id}
                channel={channel as any}
                projectId={projectId}
                onEdit={handleEdit}
              />
            ))}
          </div>
        )}

        <NotificationChannelModal
          open={showModal}
          onClose={handleClose}
          projectId={projectId}
          editChannel={editChannel}
        />
      </section>
    );
  },
);
