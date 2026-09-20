import { memo, useState, useEffect } from "react";

import { Card } from "@shared/components/card";
import { StatusBadge } from "@shared/components/status-badge";
import { LogViewer } from "@application/infrastructure/ui/components/LogViewer";

import { useDeployLogs } from "@lib/socket";
import { trpc } from "@lib/trpc";
import { cn, timeAgo } from "@lib/utils";

import { STATUS_ICONS } from "@application/infrastructure/ui/constants/application.constants";

interface DeploymentsTabPropsI {
  composeId: string;
}

/**
 * Historial de despliegues del stack.
 *
 * No hay rollback: una aplicación puede volver a una imagen anterior porque
 * DeployKit la construyó y la guardó, pero un stack son imágenes de terceros
 * más configuración. Volver atrás es editar el Compose y redesplegar.
 */
export const DeploymentsTab: React.FC<DeploymentsTabPropsI> = memo(
  function DeploymentsTab({ composeId }) {
    const { data: deploymentsList } = trpc.compose.deployments.useQuery({
      id: composeId,
    });

    const [selectedDeployId, setSelectedDeployId] = useState<string | null>(
      null,
    );

    // Al entrar desde el botón de deploy, abrir el despliegue en curso.
    useEffect(() => {
      if (selectedDeployId || !deploymentsList?.length) return;
      const active = deploymentsList.find(
        (d) => d.status === "queued" || d.status === "deploying",
      );
      if (active) setSelectedDeployId(active.id);
    }, [deploymentsList, selectedDeployId]);

    const { logs: liveLogs, status: liveStatus } =
      useDeployLogs(selectedDeployId);

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
              {deploymentsList.map((d) => (
                <button
                  key={d.id}
                  onClick={() =>
                    setSelectedDeployId(d.id === selectedDeployId ? null : d.id)
                  }
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-colors text-left",
                    d.id === selectedDeployId
                      ? "bg-accent-muted"
                      : "hover:bg-surface-2",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
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
                    <div className="min-w-0">
                      <StatusBadge status={d.status} />
                      {d.errorMessage && (
                        <p className="text-xs text-danger mt-0.5 truncate max-w-md">
                          {d.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-text-muted whitespace-nowrap shrink-0">
                    {timeAgo(d.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

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
                  : ["No logs recorded for this deployment."]
              }
            />
          </Card>
        )}
      </div>
    );
  },
);
