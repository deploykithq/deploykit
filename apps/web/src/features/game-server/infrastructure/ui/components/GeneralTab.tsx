import { memo } from "react";
import { AlertTriangle, Info, Network, Server } from "lucide-react";

import { Card } from "@shared/components/card";
import { StatusBadge } from "@shared/components/status-badge";

import { ConnectionField } from "@database/infrastructure/ui/components/ConnectionField";

import type { GameServerTabPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const GeneralTab: React.FC<GameServerTabPropsI> = memo(function GeneralTab({
  server,
}) {
  const missingAddress = server.connect.some((c) => c.address === null);

  const rows: Array<[string, React.ReactNode]> = [
    ["Game", `${server.gameName} · ${server.specVersion}`],
    ["Image", <span className="font-mono text-xs">{server.image}</span>],
    ["Memory", `${server.memoryMb} MB`],
    ...(server.cpuMillicores
      ? ([["CPU", `${server.cpuMillicores / 1000} cores`]] as Array<
          [string, React.ReactNode]
        >)
      : []),
    ["Created", new Date(server.createdAt).toLocaleString()],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Server className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium">Status</h3>
          <StatusBadge status={server.status} />
        </div>
        {server.statusMessage ? (
          <div
            className={
              server.status === "error"
                ? "p-3 rounded-lg bg-danger/10 text-danger text-xs flex items-start gap-2"
                : "p-3 rounded-lg bg-surface-2 text-text-secondary text-xs flex items-start gap-2"
            }
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap break-words">
              {server.statusMessage}
            </span>
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            {server.status === "provisioning"
              ? "Pulling the image and creating the container. This can take a few minutes the first time."
              : server.status === "restoring"
                ? "Restoring a world backup. The server starts again when it finishes."
                : server.status === "running"
                  ? "The server is up."
                  : server.status === "idle"
                    ? "Not started yet. Add mods and adjust settings first: the world is created on the first start."
                    : "The server is not running."}
          </p>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Network className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium">Connect</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {server.connect.map((c) => (
            <ConnectionField
              key={`${c.name}-${c.protocol}`}
              label={`${c.name} (${c.protocol.toUpperCase()})`}
              value={c.address ?? String(c.port)}
              mono
            />
          ))}
        </div>
        {missingAddress && (
          <p className="text-xs text-text-muted mt-3">
            The public address is unknown, so only the port is shown. Set{" "}
            <code className="text-accent">PUBLIC_IP</code> on the DeployKit
            server to show the full address players connect to.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-medium mb-3">Server</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 min-w-0">
              <dt className="text-text-secondary shrink-0">{label}</dt>
              <dd className="text-right truncate">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {server.spec.notes && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium">Notes</h3>
          </div>
          <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
            {server.spec.notes}
          </p>
        </Card>
      )}
    </div>
  );
});
