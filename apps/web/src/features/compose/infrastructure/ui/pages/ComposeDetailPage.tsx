import { lazy, Suspense } from "react";
import {
  ArrowLeft,
  Layers,
  Play,
  RefreshCw,
  Rocket,
  Square,
  Trash2,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { StatusBadge } from "@shared/components/status-badge";

import {
  GeneralTab,
  ComposeFileTab,
  EnvVarsTab,
  DomainsTab,
  DeploymentsTab,
  LogsTab,
  MonitoringTab,
} from "@compose/infrastructure/ui/components";

const TerminalTab = lazy(() =>
  import("@compose/infrastructure/ui/components/TerminalTab").then((m) => ({
    default: m.TerminalTab,
  })),
);

import { useComposeDetail } from "@compose/infrastructure/ui/hooks/useComposeDetail";

import { cn } from "@lib/utils";

import { TABS } from "@compose/infrastructure/ui/constants/compose.constants";

export const ComposeDetailPage = () => {
  const {
    composeId,
    stack,
    isLoading,
    onBack,
    canOperate,
    canDelete,
    activeTab,
    setActiveTab,
    showDeleteConfirm,
    setShowDeleteConfirm,
    containers,
    selectedContainerId,
    setSelectedContainerId,
    deployMutation,
    startMutation,
    stopMutation,
    restartMutation,
    deleteMutation,
  } = useComposeDetail();

  if (isLoading)
    return <div className="text-sm text-text-muted p-6">Loading...</div>;
  if (!stack)
    return <div className="text-sm text-danger p-6">Stack not found</div>;

  const busy = stack.status === "deploying";

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
            <Layers className="w-4 h-4 text-accent shrink-0" />
            <h1 className="text-xl font-semibold truncate">{stack.name}</h1>
            <StatusBadge status={stack.status} />
          </div>
          <p className="text-xs text-text-muted mt-0.5 font-mono">
            compose · {containers.length} container
            {containers.length === 1 ? "" : "s"}
            {stack.templateId ? ` · ${stack.templateId}` : ""}
          </p>
        </div>

        {canOperate && (
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                title="Delete stack"
              >
                <Trash2 className="w-3.5 h-3.5 text-danger" />
              </Button>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => restartMutation.mutate({ id: composeId })}
              disabled={restartMutation.isPending || busy}
              title="Restart every container"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>

            {stack.status === "running" ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => stopMutation.mutate({ id: composeId })}
                disabled={stopMutation.isPending || busy}
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => startMutation.mutate({ id: composeId })}
                disabled={startMutation.isPending || busy}
              >
                <Play className="w-3.5 h-3.5" />
                Start
              </Button>
            )}

            <Button
              size="sm"
              onClick={() =>
                deployMutation.mutate({ id: composeId, mode: "redeploy" })
              }
              disabled={deployMutation.isPending || busy}
            >
              <Rocket className="w-3.5 h-3.5" />
              {busy ? "Deploying..." : "Redeploy"}
            </Button>
          </div>
        )}
      </div>

      {deployMutation.error && (
        <p className="text-xs text-danger">{deployMutation.error.message}</p>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-px overflow-x-auto scrollbar-none">
        {TABS.map((tab) => (
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
        {activeTab === "general" && (
          <GeneralTab stack={stack} containers={containers} />
        )}
        {activeTab === "compose" && (
          <ComposeFileTab
            stack={stack}
            composeId={composeId}
            canOperate={canOperate}
          />
        )}
        {activeTab === "env" && (
          <EnvVarsTab
            stack={stack}
            composeId={composeId}
            canOperate={canOperate}
          />
        )}
        {activeTab === "domains" && (
          <DomainsTab
            stack={stack}
            composeId={composeId}
            canOperate={canOperate}
          />
        )}
        {activeTab === "deployments" && (
          <DeploymentsTab composeId={composeId} />
        )}
        {activeTab === "logs" && (
          <LogsTab
            composeId={composeId}
            containers={containers}
            selectedContainerId={selectedContainerId}
            onSelectContainer={setSelectedContainerId}
          />
        )}
        {activeTab === "terminal" && (
          <Suspense
            fallback={
              <div className="text-sm text-text-muted p-6">
                Loading terminal...
              </div>
            }
          >
            <TerminalTab
              containers={containers}
              selectedContainerId={selectedContainerId}
              onSelectContainer={setSelectedContainerId}
            />
          </Suspense>
        )}
        {activeTab === "monitoring" && <MonitoringTab composeId={composeId} />}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate({ id: composeId })}
        title="Delete stack"
        description={`This permanently deletes "${stack.name}", stops every container and destroys the stack's volumes. Data in those volumes cannot be recovered.`}
        confirmText="Delete stack"
        isPending={deleteMutation.isPending}
      />
    </div>
  );
};
