import { memo } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Container,
  Cpu,
  Download,
  HardDrive,
  Key,
  MemoryStick,
  Monitor,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { StatusBadge } from "@shared/components/status-badge";

import { ServerServices } from "@server/infrastructure/ui/components";

import { useServerCard } from "@server/infrastructure/ui/hooks/useServerCard";

import { formatBytes, timeAgo } from "@lib/utils";

interface ServerCardPropsI {
  server: any;
  isAdmin: boolean;
  onDelete: () => void;
}

export const ServerCard: React.FC<ServerCardPropsI> = memo(function ServerCard({
  server,
  isAdmin,
  onDelete,
}) {
  const {
    showInstallConfirm,
    setShowInstallConfirm,
    healthResult,
    isChecking,
    isInstalling,
    installSucceeded,
    installResult,
    runHealthCheck,
    installDocker,
  } = useServerCard();

  const showInstallDocker =
    healthResult &&
    !healthResult.dockerInstalled &&
    healthResult.status !== "error" &&
    !server.isLocal;

  return (
    <>
      <Card>
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
            {server.isLocal ? (
              <Monitor className="w-4 h-4 text-accent" />
            ) : (
              <Server className="w-4 h-4 text-text-secondary" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {server.name}
              </span>
              {server.isLocal && (
                <span className="text-[10px] uppercase tracking-wider font-medium text-accent bg-accent-muted px-1.5 py-0.5 rounded">
                  Local
                </span>
              )}
              <StatusBadge status={server.status} />
              {server.hasKey && !server.isLocal && (
                <Key className="w-3 h-3 text-text-muted" />
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
              <span className="font-mono">
                {server.isLocal
                  ? "localhost (Docker)"
                  : `${server.username}@${server.host}:${server.port}`}
              </span>
              {server.dockerVersion && (
                <span>Docker {server.dockerVersion}</span>
              )}
              {server.lastHealthCheck && (
                <span>Checked {timeAgo(server.lastHealthCheck)}</span>
              )}
            </div>
          </div>

          {/* Actions */}
          {isAdmin && (
            <div className="flex gap-1.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => runHealthCheck(server.id)}
                disabled={isChecking}
                title="Check health"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`}
                />
              </Button>
              {!server.isLocal && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  title="Remove server"
                >
                  <Trash2 className="w-3.5 h-3.5 text-danger" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Resource info */}
        {(server.totalCpu || server.totalMemory || healthResult?.cpuCores) && (
          <div className="mt-3 pt-3 border-t border-border flex gap-4 flex-wrap">
            {healthResult?.os && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Monitor className="w-3 h-3" />
                {healthResult.os}
              </div>
            )}
            {(healthResult?.cpuCores || server.totalCpu) && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Cpu className="w-3 h-3" />
                {healthResult?.cpuCores || server.totalCpu} cores
              </div>
            )}
            {(healthResult?.totalMemory || server.totalMemory) && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <MemoryStick className="w-3 h-3" />
                {formatBytes(
                  healthResult?.totalMemory || server.totalMemory,
                )}{" "}
                RAM
              </div>
            )}
            {(healthResult?.totalDisk || server.totalDisk) && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <HardDrive className="w-3 h-3" />
                {formatBytes(healthResult?.totalDisk || server.totalDisk)} disk
              </div>
            )}
            {healthResult?.containers !== undefined && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Container className="w-3 h-3" />
                {healthResult.containers} containers
              </div>
            )}
          </div>
        )}

        {/* Deployed services */}
        <ServerServices
          applications={server.applications || []}
          databases={server.databases || []}
        />

        {/* Docker not installed — offer install */}
        {showInstallDocker && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between p-3 rounded-lg bg-warning/5 border border-warning/20">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Docker not installed
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    SSH connection works. Install Docker to start deploying apps
                    to this server.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => setShowInstallConfirm(true)}
                disabled={isInstalling}
              >
                <Download className="w-3.5 h-3.5" />
                Install Docker
              </Button>
            </div>
          </div>
        )}

        {/* Installing Docker progress */}
        {isInstalling && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/5 border border-accent/20">
              <RefreshCw className="w-4 h-4 text-accent animate-spin shrink-0" />
              <div>
                <p className="text-sm font-medium text-text-primary">
                  Installing Docker...
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  This may take a few minutes. Running the official Docker
                  install script.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Install result */}
        {installSucceeded && installResult && (
          <div className="mt-3 pt-3 border-t border-border">
            {installResult.success ? (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-success/10 text-success text-xs">
                <CheckCircle className="w-3.5 h-3.5" />
                Docker {installResult.version} installed
                successfully! Run health check to verify.
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-danger/10 text-danger text-xs">
                <AlertTriangle className="w-3.5 h-3.5" />
                {installResult.error}
              </div>
            )}
          </div>
        )}

        {/* Health check error */}
        {healthResult?.error && healthResult.dockerInstalled !== false && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-danger flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {healthResult.error}
            </p>
          </div>
        )}

        {/* SSH connection error */}
        {healthResult?.status === "error" && !healthResult.dockerInstalled && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-danger flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              SSH connection failed: {healthResult.error}
            </p>
          </div>
        )}
      </Card>

      {/* Confirm Docker Install */}
      <ConfirmDialog
        open={showInstallConfirm}
        onClose={() => setShowInstallConfirm(false)}
        onConfirm={() => installDocker(server.id)}
        title="Install Docker"
        description={`This will run the official Docker install script (https://get.docker.com) on ${server.name} (${server.host}). It requires root or sudo access. Continue?`}
        confirmText="Install"
        variant="primary"
        isPending={isInstalling}
      />
    </>
  );
});
