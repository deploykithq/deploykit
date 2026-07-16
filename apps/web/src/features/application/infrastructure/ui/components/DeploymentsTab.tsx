import React, { memo, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Card, Button, StatusBadge, ConfirmDialog } from "@shared/components";
import { LogViewer } from "@application/infrastructure/ui/components/LogViewer";
import {
  VulnerabilityBadge,
  ScanResultsPanel,
} from "@application/infrastructure/ui/components/VulnerabilityBadge";

import { trpc } from "@lib/trpc";
import { useDeployLogs } from "@lib/socket";
import { timeAgo, cn } from "@lib/utils";

import { STATUS_ICONS } from "@application/infrastructure/ui/constants/applications.constants";
import { getStoredLogs } from "@application/infrastructure/ui/utils/applications.utils";

interface DeploymentsTabPropsI {
  applicationId: string;
}

export const DeploymentsTab: React.FC<DeploymentsTabPropsI> = memo(
  function DeploymentsTab({ applicationId }) {
    const utils = trpc.useUtils();
    const { data: app } = trpc.application.byId.useQuery({ id: applicationId });
    const { data: deploymentsList } = trpc.application.deployments.useQuery({
      id: applicationId,
    });

    const [selectedDeployId, setSelectedDeployId] = useState<string | null>(
      null,
    );
    const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);

    const { logs: liveLogs, status: liveStatus } =
      useDeployLogs(selectedDeployId);

    const rollbackMutation = trpc.application.rollback.useMutation({
      onSuccess: (newDeploy) => {
        utils.application.byId.invalidate({ id: applicationId });
        utils.application.deployments.invalidate({ id: applicationId });
        setRollbackTarget(null);
        setSelectedDeployId(newDeploy.id);
      },
      onError: (err) => {
        utils.application.byId.invalidate({ id: applicationId });
        utils.application.deployments.invalidate({ id: applicationId });
        setRollbackTarget(null);
        alert(`Rollback failed: ${err.message}`);
      },
    });

    const currentDeployId = useMemo(
      () => deploymentsList?.find((d) => d.status === "success")?.id,
      [deploymentsList],
    );
    const rollbackTargetDeploy = useMemo(
      () => deploymentsList?.find((d) => d.id === rollbackTarget),
      [deploymentsList, rollbackTarget],
    );

    return (
      <div className="space-y-4">
        <Card>
          <h3 className="text-sm font-medium mb-3">Deployment history</h3>

          {!deploymentsList?.length ? (
            <p className="text-sm text-text-muted py-4 text-center">
              No deployments yet. Click "Deploy" to start.
            </p>
          ) : (
            <div className="space-y-1">
              {deploymentsList.map((d) => {
                const isLive = d.id === currentDeployId;
                const isSelected = d.id === selectedDeployId;
                const hasImage = !!d.imageName;
                const isRollback = d.commitMessage?.startsWith("Rollback to");
                const canRollback =
                  d.status === "success" && hasImage && !isLive;

                return (
                  <div
                    key={d.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors",
                      isSelected ? "bg-accent-muted" : "hover:bg-surface-2",
                      isLive && "ring-1 ring-accent/30",
                    )}
                  >
                    <button
                      onClick={() =>
                        setSelectedDeployId(
                          d.id === selectedDeployId ? null : d.id,
                        )
                      }
                      className="flex items-center gap-3 flex-1 text-left min-w-0"
                    >
                      <span
                        className={cn(
                          "text-sm shrink-0",
                          d.status === "success" && "text-success",
                          d.status === "failed" && "text-danger",
                          d.status === "deploying" && "text-accent",
                        )}
                      >
                        {STATUS_ICONS[d.status] || "•"}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={d.status} />

                          {d.commitHash && (
                            <span className="text-xs font-mono text-text-muted">
                              {d.commitHash}
                            </span>
                          )}

                          {isLive && (
                            <span className="text-[10px] uppercase tracking-wider font-medium text-accent bg-accent-muted px-1.5 py-0.5 rounded">
                              Live
                            </span>
                          )}

                          {isRollback && (
                            <span className="text-[10px] uppercase tracking-wider font-medium text-text-muted bg-surface-2 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <RotateCcw className="w-2.5 h-2.5" /> Rollback
                            </span>
                          )}

                          {d.status === "success" && !hasImage && (
                            <span
                              className="text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 rounded"
                              title="No image stored — cannot roll back"
                            >
                              No image
                            </span>
                          )}

                          <VulnerabilityBadge
                            scanStatus={d.scanStatus}
                            summary={d.scanResults?.summary}
                          />
                        </div>

                        {d.commitMessage && (
                          <p className="text-xs text-text-muted mt-0.5 truncate max-w-xs">
                            {d.commitMessage}
                          </p>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-1 sm:ml-2">
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        {timeAgo(d.createdAt)}
                      </span>

                      {canRollback && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRollbackTarget(d.id);
                          }}
                          title={`Roll back to ${d.commitHash || d.id.slice(0, 8)}`}
                          disabled={rollbackMutation.isPending}
                        >
                          <RotateCcw
                            className={cn(
                              "w-3.5 h-3.5",
                              rollbackMutation.isPending &&
                                rollbackTarget === d.id &&
                                "animate-spin",
                            )}
                          />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {selectedDeployId &&
          (() => {
            const selected = deploymentsList?.find(
              (d) => d.id === selectedDeployId,
            );
            if (!selected?.scanStatus) return null;
            return (
              <Card>
                <h3 className="text-sm font-medium mb-3">Security scan</h3>
                <ScanResultsPanel
                  scanStatus={selected.scanStatus}
                  results={selected.scanResults}
                />
              </Card>
            );
          })()}

        {selectedDeployId && (
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-medium">Deploy logs</h3>
              {liveStatus && <StatusBadge status={liveStatus} />}
            </div>
            <LogViewer
              lines={
                liveLogs.length > 0
                  ? liveLogs
                  : getStoredLogs(deploymentsList, selectedDeployId)
              }
            />
          </Card>
        )}

        <ConfirmDialog
          open={!!rollbackTarget}
          onClose={() => setRollbackTarget(null)}
          onConfirm={() =>
            rollbackTarget &&
            rollbackMutation.mutate({
              applicationId,
              deploymentId: rollbackTarget,
            })
          }
          title="Roll back deployment"
          description={
            rollbackTargetDeploy
              ? `Start the container using the image from commit ${rollbackTargetDeploy.commitHash || rollbackTargetDeploy.id.slice(0, 8)}. No rebuild required — the existing image is reused.${(app?.domains?.length ?? 0) > 0 ? " Traefik routing will be restored automatically." : ""}`
              : "Roll back to this deployment? No rebuild required."
          }
          confirmText="Roll back"
          variant="primary"
          isPending={rollbackMutation.isPending}
        />
      </div>
    );
  },
);
