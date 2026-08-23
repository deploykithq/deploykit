import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Rocket, Clock } from "lucide-react";

import { Card } from "@shared/components/card";
import { StatusBadge } from "@shared/components/status-badge";

import { timeAgo } from "@lib/utils";

import {
  DEPLOY_STATUS_ICON,
  DEPLOY_STATUS_COLOR,
} from "@dashboard/infrastructure/ui/constants/dashboard.constants";
import type { DashboardDeployI } from "@dashboard/infrastructure/ui/interfaces/dashboard.interfaces";

interface RecentDeploysPropsI {
  deploys: DashboardDeployI[];
  deploys7d: number;
}

export const RecentDeploys: React.FC<RecentDeploysPropsI> = memo(
  function RecentDeploys({ deploys, deploys7d }) {
    const navigate = useNavigate();

    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-secondary flex items-center gap-2">
            <Rocket className="w-3.5 h-3.5" />
            Recent Deployments
          </h2>
          <span className="text-xs text-text-muted">{deploys7d} this week</span>
        </div>

        {deploys.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <Rocket className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">No deployments yet</p>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-border -my-1">
              {deploys.slice(0, 8).map((deploy) => {
                const StatusIcon = DEPLOY_STATUS_ICON[deploy.status] || Clock;
                const statusColor =
                  DEPLOY_STATUS_COLOR[deploy.status] || "text-text-muted";

                return (
                  <div
                    key={deploy.id}
                    className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-surface-2/50 -mx-4 px-4 transition-colors"
                    onClick={() => {
                      if (deploy.application) {
                        navigate({
                          to: "/projects/$projectId/apps/$appId",
                          params: {
                            projectId: deploy.application.projectId,
                            appId: deploy.application.id,
                          },
                        });
                      }
                    }}
                  >
                    <StatusIcon className={`w-4 h-4 shrink-0 ${statusColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {deploy.application?.name || "Unknown"}
                        </span>
                        <StatusBadge status={deploy.status} />
                      </div>
                      {deploy.commitMessage && (
                        <p className="text-xs text-text-muted truncate mt-0.5">
                          {deploy.commitHash && (
                            <span className="font-mono text-text-secondary">
                              {deploy.commitHash.slice(0, 7)}{" "}
                            </span>
                          )}
                          {deploy.commitMessage}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-text-muted shrink-0">
                      {timeAgo(deploy.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </section>
    );
  },
);
