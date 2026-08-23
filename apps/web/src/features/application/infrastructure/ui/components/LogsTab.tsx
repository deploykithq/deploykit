import { memo, useState } from "react";

import { Card } from "@shared/components/card";
import { LogSearchPanel } from "@shared/components/log-search-panel";
import { LogViewer } from "@application/infrastructure/ui/components/LogViewer";

import { useApplicationLogs } from "@application/infrastructure/ui/hooks/useApplicationLogs";

import { cn } from "@lib/utils";

import type { LogModeT } from "@application/infrastructure/ui/interfaces/application.interfaces";

interface LogsTabPropsI {
  app: any;
}

export const LogsTab: React.FC<LogsTabPropsI> = memo(function LogsTab({ app }) {
  const { mode, setMode, allLogs } = useApplicationLogs(app);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-medium">Container Logs</h3>
        <div className="flex items-center gap-2">
          {mode === "live" && !app.containerId && (
            <span className="text-xs text-text-muted">No running container</span>
          )}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(["live", "history"] as LogModeT[]).map((m) => (
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
        <LogViewer
          lines={
            allLogs.length > 0
              ? allLogs
              : ["No logs available. Deploy your application first."]
          }
        />
      ) : (
        <LogSearchPanel serviceId={app.id} serviceType="application" />
      )}
    </Card>
  );
});
