import { memo } from "react";
import {
  Bell,
  BellOff,
  CheckCircle2,
  Loader2,
  Pencil,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";

import { useNotificationChannelCard } from "@project/infrastructure/ui/hooks/useNotificationChannelCard";

import {
  CHANNEL_COLORS,
  CHANNEL_ICONS,
} from "@project/infrastructure/ui/constants/project.constants";

interface NotificationChannelCardPropsI {
  channel: {
    id: string;
    name: string;
    type: string;
    config: Record<string, string>;
    events: string[];
    enabled: boolean;
  };
  projectId: string;
  onEdit: (channel: any) => void;
}

export const NotificationChannelCard: React.FC<NotificationChannelCardPropsI> =
  memo(function NotificationChannelCard({ channel, projectId, onEdit }) {
    const {
      showDelete,
      setShowDelete,
      testResult,
      canWrite,
      toggleMutation,
      deleteMutation,
      testMutation,
    } = useNotificationChannelCard(projectId);

    const Icon = CHANNEL_ICONS[channel.type] || Bell;
    const colorClass = CHANNEL_COLORS[channel.type] || "text-text-secondary";

    const eventLabels = (channel.events as string[])
      .map((e) =>
        e.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      )
      .join(", ");

    return (
      <>
        <Card>
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div
              className={`w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center shrink-0 ${colorClass}`}
            >
              <Icon className="w-4 h-4" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {channel.name}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted uppercase tracking-wider">
                  {channel.type}
                </span>
                {!channel.enabled && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger">
                    Disabled
                  </span>
                )}
              </div>

              <p className="text-xs text-text-muted mt-0.5 truncate">
                {eventLabels}
              </p>

              {/* Test result */}
              {testResult && (
                <div
                  className={`flex items-center gap-1 mt-1.5 text-xs ${
                    testResult.success ? "text-green-400" : "text-danger"
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {testResult.success
                    ? "Test sent successfully"
                    : `Failed: ${testResult.error}`}
                </div>
              )}
            </div>

            {/* Actions */}
            {canWrite && (
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    testMutation.mutate({
                      type: channel.type as any,
                      config: channel.config,
                    })
                  }
                  disabled={testMutation.isPending}
                  title="Send test notification"
                >
                  {testMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(channel)}
                  title="Edit channel"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleMutation.mutate({ id: channel.id })}
                  disabled={toggleMutation.isPending}
                  title={channel.enabled ? "Disable" : "Enable"}
                >
                  {channel.enabled ? (
                    <BellOff className="w-3.5 h-3.5" />
                  ) : (
                    <Bell className="w-3.5 h-3.5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDelete(true)}
                  title="Delete channel"
                >
                  <Trash2 className="w-3.5 h-3.5 text-danger" />
                </Button>
              </div>
            )}
          </div>
        </Card>

        <ConfirmDialog
          open={showDelete}
          onClose={() => setShowDelete(false)}
          onConfirm={() => deleteMutation.mutate({ id: channel.id })}
          title="Delete Channel"
          description={`Delete notification channel "${channel.name}"? No more notifications will be sent to this channel.`}
          confirmText="Delete"
          isPending={deleteMutation.isPending}
        />
      </>
    );
  });
