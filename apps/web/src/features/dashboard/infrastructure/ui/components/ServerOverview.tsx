import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Server } from "lucide-react";

import { Card } from "@shared/components/card";

import { formatBytes } from "@lib/utils";

import type { DashboardServerI } from "@dashboard/infrastructure/ui/interfaces/dashboard.interfaces";

interface ServerOverviewPropsI {
  servers: DashboardServerI[];
}

export const ServerOverview: React.FC<ServerOverviewPropsI> = memo(
  function ServerOverview({ servers }) {
    const navigate = useNavigate();

    if (servers.length === 0) return null;

    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-secondary flex items-center gap-2">
            <Server className="w-3.5 h-3.5" />
            Servers
          </h2>
          <button
            onClick={() => navigate({ to: "/servers" })}
            className="text-xs text-accent hover:underline"
          >
            View all
          </button>
        </div>
        <div className="space-y-2">
          {servers.map((server) => (
            <Card key={server.id}>
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    server.status === "connected"
                      ? "bg-green-400"
                      : server.status === "error"
                        ? "bg-red-400"
                        : "bg-neutral-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{server.name}</p>
                  <p className="text-[11px] text-text-muted">
                    {server.isLocal ? "localhost" : server.host}
                    {server.totalMemory &&
                      ` · ${formatBytes(server.totalMemory)} RAM`}
                    {server.totalCpu && ` · ${server.totalCpu} cores`}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    );
  },
);
