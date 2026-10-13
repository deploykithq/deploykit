import { lazy, Suspense } from "react";
import { ArrowLeft, Gamepad2, Play, RefreshCw, Square, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";
import { StatusBadge } from "@shared/components/status-badge";

import {
  BackupsTab,
  DeleteGameServerDialog,
  FilesTab,
  GeneralTab,
  LogsTab,
  ModsTab,
  MonitoringTab,
  SettingsTab,
} from "@game-server/infrastructure/ui/components";

import { useGameServerDetail } from "@game-server/infrastructure/ui/hooks/useGameServerDetail";

import { cn } from "@lib/utils";

// xterm is heavy: load the console only when its tab opens.
const ConsoleTab = lazy(() =>
  import("@game-server/infrastructure/ui/components/ConsoleTab").then((m) => ({
    default: m.ConsoleTab,
  })),
);

export const GameServerDetailPage: React.FC = () => {
  const {
    server,
    isLoading,
    permissions,
    tabs,
    activeTab,
    setActiveTab,
    onBack,
    busy,
    actionError,
    start,
    stop,
    restart,
    starting,
    stopping,
    restarting,
    showDelete,
    setShowDelete,
    deleteData,
    setDeleteData,
    remove,
    deleting,
    deleteError,
  } = useGameServerDetail();

  if (isLoading)
    return <div className="text-sm text-text-muted p-6">Loading...</div>;
  if (!server || !permissions)
    return <div className="text-sm text-danger p-6">Game server not found</div>;

  const running = server.status === "running";
  const tabProps = { server, permissions };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <Gamepad2 className="w-4 h-4 text-success shrink-0" />
            <h1 className="text-xl font-semibold truncate">{server.name}</h1>
            <StatusBadge status={server.status} />
          </div>
          <p className="text-xs text-text-muted mt-0.5 font-mono">
            {server.gameName} · {server.specVersion} · {server.memoryMb} MB
            {server.ports[0] &&
              ` · port ${server.ports[0].hostPort}/${server.ports[0].protocol}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          {permissions.isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDelete(true)}
              title="Delete game server"
            >
              <Trash2 className="w-3.5 h-3.5 text-danger" />
            </Button>
          )}
          {permissions.canOperate && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={restart}
                disabled={busy || !running}
                title="Restart the server"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", restarting && "animate-spin")} />
              </Button>
              {running ? (
                <Button variant="danger" size="sm" onClick={stop} disabled={busy}>
                  <Square className="w-3.5 h-3.5" />
                  {stopping ? "Stopping…" : "Stop"}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={start} disabled={busy}>
                  <Play className="w-3.5 h-3.5" />
                  {starting ? "Starting…" : "Start"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {actionError && <p className="text-xs text-danger">{actionError}</p>}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-px overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm rounded-t-lg transition-colors relative shrink-0",
              activeTab === tab.id
                ? "text-text-primary bg-surface-1"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "general" && <GeneralTab {...tabProps} />}
        {activeTab === "settings" && <SettingsTab {...tabProps} />}
        {activeTab === "console" && (
          <Suspense
            fallback={
              <div className="text-sm text-text-muted p-6">Loading console...</div>
            }
          >
            <ConsoleTab {...tabProps} />
          </Suspense>
        )}
        {activeTab === "files" && <FilesTab {...tabProps} />}
        {activeTab === "mods" && <ModsTab {...tabProps} />}
        {activeTab === "backups" && <BackupsTab {...tabProps} />}
        {activeTab === "logs" && <LogsTab {...tabProps} />}
        {activeTab === "monitoring" && <MonitoringTab {...tabProps} />}
      </div>

      <DeleteGameServerDialog
        open={showDelete}
        name={server.name}
        deleteData={deleteData}
        onDeleteDataChange={setDeleteData}
        onClose={() => {
          setShowDelete(false);
          setDeleteData(false);
        }}
        onConfirm={remove}
        isPending={deleting}
        error={deleteError}
      />
    </div>
  );
};
