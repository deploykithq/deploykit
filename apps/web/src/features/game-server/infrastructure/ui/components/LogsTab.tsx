import { memo, useState } from "react";

import { Card } from "@shared/components/card";
import { LogSearchPanel } from "@shared/components/log-search-panel";

import { LogViewer } from "@application/infrastructure/ui/components/LogViewer";

import { useContainerLogs } from "@lib/socket";
import { cn } from "@lib/utils";

import type { GameServerTabPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

type ModeT = "live" | "history";

/** Live container log, or a search over the persisted history. */
export const LogsTab: React.FC<GameServerTabPropsI> = memo(function LogsTab({ server }) {
  const [mode, setMode] = useState<ModeT>("live");
  const { logs } = useContainerLogs(
    mode === "live" ? (server.containerId ?? null) : null,
  );

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-medium">Server logs</h3>
        <div className="flex items-center gap-2">
          {mode === "live" && !server.containerId && (
            <span className="text-xs text-text-muted">No container yet</span>
          )}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(["live", "history"] as ModeT[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "px-3 py-1.5 capitalize transition-colors",
                  mode === m
                    ? "bg-surface-2 text-text-primary"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === "live" ? (
        <LogViewer lines={logs.length > 0 ? logs : ["Waiting for live logs…"]} />
      ) : (
        <LogSearchPanel serviceId={server.id} serviceType="game_server" />
      )}
    </Card>
  );
});
