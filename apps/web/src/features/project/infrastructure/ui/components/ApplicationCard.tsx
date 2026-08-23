import { memo } from "react";
import { Box, Globe } from "lucide-react";

import { Card } from "@shared/components/card";
import { StatusBadge } from "@shared/components/status-badge";

import { timeAgo } from "@lib/utils";
import type { ApplicationI } from "@project/infrastructure/ui/interfaces/project.interfaces";

interface ApplicationCardPropsI {
  app: ApplicationI;
  onClick: () => void;
}

export const ApplicationCard: React.FC<ApplicationCardPropsI> = memo(
  function ApplicationCard({ app, onClick }) {
    const firstDomain = app.domains?.[0];

    return (
      <Card hoverable onClick={onClick}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-info/10 flex items-center justify-center">
              <Box className="w-4 h-4 text-info" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">{app.name}</h3>
                <StatusBadge status={app.status} />
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-text-muted">
                  {app.sourceType}
                </span>
                {app.branch && (
                  <span className="text-xs text-text-muted font-mono">
                    {app.branch}
                  </span>
                )}
                {firstDomain && (
                  <span className="text-xs text-accent flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    {firstDomain.domain}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className="text-xs text-text-muted mr-2">
            {timeAgo(app.updatedAt)}
          </span>
        </div>
      </Card>
    );
  },
);
