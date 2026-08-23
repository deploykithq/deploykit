import { memo } from "react";
import { Server, Monitor } from "lucide-react";

import { useServerSelector } from "@project/infrastructure/ui/hooks/useServerSelector";

interface ServerSelectorPropsI {
  value: string | null;
  onChange: (serverId: string | null) => void;
  label?: string;
}

export const ServerSelector: React.FC<ServerSelectorPropsI> = memo(
  function ServerSelector({ value, onChange, label = "Deploy Server" }) {
    const { available } = useServerSelector();

    if (available.length === 0) return null; // Don't show if no servers configured

    // If only 1 server (local), don't show either
    if (available.length === 1 && available[0]?.isLocal) return null;

    return (
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">
          {label}
        </label>
        <div className="grid gap-2">
          {available.map((server) => {
            const isSelected =
              (value === null && server.isLocal) || value === server.id;

            return (
              <button
                key={server.id}
                type="button"
                onClick={() => onChange(server.isLocal ? null : server.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  isSelected
                    ? "border-accent bg-accent/5"
                    : "border-border bg-surface-2 hover:bg-surface-3"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                    isSelected ? "bg-accent/10" : "bg-surface-3"
                  }`}
                >
                  {server.isLocal ? (
                    <Monitor
                      className={`w-3.5 h-3.5 ${
                        isSelected ? "text-accent" : "text-text-muted"
                      }`}
                    />
                  ) : (
                    <Server
                      className={`w-3.5 h-3.5 ${
                        isSelected ? "text-accent" : "text-text-muted"
                      }`}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        isSelected ? "text-accent" : "text-text-primary"
                      }`}
                    >
                      {server.name}
                    </span>
                    {server.isLocal && (
                      <span className="text-[10px] uppercase tracking-wider font-medium text-accent bg-accent-muted px-1.5 py-0.5 rounded">
                        Local
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted font-mono truncate">
                    {server.isLocal
                      ? "Docker Engine local"
                      : `${server.username}@${server.host}:${server.port}`}
                  </p>
                </div>
                {isSelected && (
                  <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  },
);
