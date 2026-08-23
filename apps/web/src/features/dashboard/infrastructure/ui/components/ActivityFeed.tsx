import { memo } from "react";
import { Activity } from "lucide-react";

import { Card } from "@shared/components/card";

import { timeAgo } from "@lib/utils";

import { ACTION_CONFIG } from "@dashboard/infrastructure/ui/constants/dashboard.constants";
import type { DashboardActivityI } from "@dashboard/infrastructure/ui/interfaces/dashboard.interfaces";

interface ActivityFeedPropsI {
  entries: DashboardActivityI[];
}

export const ActivityFeed: React.FC<ActivityFeedPropsI> = memo(
  function ActivityFeed({ entries }) {
    return (
      <section>
        <h2 className="text-sm font-medium text-text-secondary flex items-center gap-2 mb-3">
          <Activity className="w-3.5 h-3.5" />
          Activity
        </h2>
        <Card>
          {entries.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-6">
              No activity yet
            </p>
          ) : (
            <div className="space-y-0">
              {entries.slice(0, 12).map((entry) => {
                const config = ACTION_CONFIG[entry.action] || {
                  label: entry.action.replace(/\./g, " "),
                  icon: Activity,
                  color: "text-text-muted",
                };
                const Icon = config.icon;

                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2.5 py-2 border-b border-border last:border-0"
                  >
                    <Icon
                      className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${config.color}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed">
                        <span className="text-text-secondary">
                          {entry.userEmail?.split("@")[0] || "System"}
                        </span>{" "}
                        <span className="text-text-muted">{config.label}</span>
                        {entry.resourceName && (
                          <>
                            {" "}
                            <span className="text-text-primary font-medium">
                              {entry.resourceName}
                            </span>
                          </>
                        )}
                      </p>
                      <p className="text-[11px] text-text-muted mt-0.5">
                        {timeAgo(entry.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>
    );
  },
);
