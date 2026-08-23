import { memo } from "react";
import { Box, Database } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { STATUS_DOT } from "@server/infrastructure/ui/constants/server.constants";

interface ServerServicesPropsI {
  applications: Array<{
    id: string;
    name: string;
    status: string;
    projectId: string;
  }>;
  databases: Array<{
    id: string;
    name: string;
    status: string;
    type: string;
    projectId: string;
  }>;
}

export const ServerServices: React.FC<ServerServicesPropsI> = memo(
  function ServerServices({ applications, databases }) {
    const navigate = useNavigate();
    const total = applications.length + databases.length;
    if (total === 0) return null;

    const running = applications.filter((a) => a.status === "running").length;
    const dbRunning = databases.filter((d) => d.status === "running").length;

    return (
      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-text-secondary">
            Deployed services
          </span>
          <span className="text-[11px] text-text-muted">
            {running + dbRunning}/{total} running
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {applications.map((app) => (
            <button
              key={app.id}
              onClick={(e) => {
                e.stopPropagation();
                navigate({
                  to: "/projects/$projectId/apps/$appId",
                  params: { projectId: app.projectId, appId: app.id },
                });
              }}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-2 hover:bg-surface-3 transition-colors text-xs group"
              title={`${app.name} — ${app.status}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[app.status] || "bg-neutral-500"}`}
              />
              <Box className="w-3 h-3 text-text-muted group-hover:text-text-secondary" />
              <span className="truncate max-w-30">{app.name}</span>
            </button>
          ))}
          {databases.map((db) => (
            <button
              key={db.id}
              onClick={(e) => {
                e.stopPropagation();
                navigate({
                  to: "/projects/$projectId/db/$dbId",
                  params: { projectId: db.projectId, dbId: db.id },
                });
              }}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-2 hover:bg-surface-3 transition-colors text-xs group"
              title={`${db.name} (${db.type}) — ${db.status}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[db.status] || "bg-neutral-500"}`}
              />
              <Database className="w-3 h-3 text-text-muted group-hover:text-text-secondary" />
              <span className="truncate max-w-30">{db.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  },
);
