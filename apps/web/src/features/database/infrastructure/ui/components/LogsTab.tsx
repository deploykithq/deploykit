import { memo, useEffect, useRef, useState } from "react";

import { Card } from "@shared/components/card";
import { LogSearchPanel } from "@shared/components/log-search-panel";

import { useContainerLogs } from "@lib/socket";
import { cn } from "@lib/utils";
import type { DatabaseI } from "@database/infrastructure/ui/interfaces/database.interfaces";

interface LogsTabPropsI {
  db: DatabaseI;
}

type ModeT = "live" | "history";

export const LogsTab: React.FC<LogsTabPropsI> = memo(function LogsTab({ db }) {
  const [mode, setMode] = useState<ModeT>("live");
  const { logs: liveLogs } = useContainerLogs(
    mode === "live" ? (db.containerId ?? null) : null,
  );
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.scrollTop = viewerRef.current.scrollHeight;
    }
  }, [liveLogs]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-medium">Database Logs</h3>
        <div className="flex items-center gap-2">
          {mode === "live" && !db.containerId && (
            <span className="text-xs text-text-muted">No running container</span>
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
        <div
          ref={viewerRef}
          className="bg-surface-0 border border-border rounded-lg p-3 sm:p-4 max-h-64 sm:max-h-96 overflow-y-auto font-mono text-xs leading-5"
        >
          {(liveLogs.length > 0
            ? liveLogs
            : ["Waiting for live logs…"]
          ).map((line, i) => (
            <div
              key={i}
              className="text-text-secondary hover:text-text-primary whitespace-pre-wrap break-all"
            >
              {line}
            </div>
          ))}
        </div>
      ) : (
        <LogSearchPanel serviceId={db.id} serviceType="database" />
      )}
    </Card>
  );
});
