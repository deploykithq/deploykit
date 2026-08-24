import { lazy, Suspense } from "react";
import {
  ArrowLeft,
  GitBranch,
  ChevronDown,
  Play,
  Square,
  Rocket,
  Trash2,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { StatusBadge } from "@shared/components/status-badge";
import {
  GeneralTab,
  EnvVarsTab,
  DomainsTab,
  DeploymentsTab,
  LogsTab,
  MonitoringTab,
  PreviewsTab,
  SecurityTab,
} from "@application/infrastructure/ui/components";

const TerminalTab = lazy(() =>
  import("@application/infrastructure/ui/components/TerminalTab").then((m) => ({
    default: m.TerminalTab,
  })),
);

import { useApplicationDetail } from "@application/infrastructure/ui/hooks/useApplicationDetail";

import { cn } from "@lib/utils";

import { TABS } from "@application/infrastructure/ui/constants/application.constants";

export const ApplicationDetailPage = () => {
  const {
    applicationId,
    app,
    isLoading,
    onBack,
    canOperate,
    activeTab,
    setActiveTab,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showBranchModal,
    setShowBranchModal,
    branchInput,
    setBranchInput,
    deployMutation,
    startMutation,
    stopMutation,
    deleteMutation,
    deployBranchMutation,
  } = useApplicationDetail();

  if (isLoading)
    return <div className="text-sm text-text-muted p-6">Loading...</div>;
  if (!app)
    return <div className="text-sm text-danger p-6">Application not found</div>;

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

        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{app.name}</h1>
            <StatusBadge status={app.status} />
          </div>
          <p className="text-xs text-text-muted mt-0.5 font-mono">
            {app.sourceType} · {app.buildType} · {app.branch}
          </p>
        </div>

        {canOperate && (
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete application"
            >
              <Trash2 className="w-3.5 h-3.5 text-danger" />
            </Button>

            {app.status === "running" && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => stopMutation.mutate({ id: applicationId })}
                disabled={stopMutation.isPending}
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </Button>
            )}

            {app.status === "stopped" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => startMutation.mutate({ id: applicationId })}
                disabled={startMutation.isPending}
              >
                <Play className="w-3.5 h-3.5" />
                Start
              </Button>
            )}

            <Button
              size="sm"
              onClick={() => deployMutation.mutate({ id: applicationId })}
              disabled={
                deployMutation.isPending ||
                app.status === "building" ||
                app.status === "deploying"
              }
            >
              <Rocket className="w-3.5 h-3.5" />
              {app.status === "building" || app.status === "deploying"
                ? "Deploying..."
                : "Deploy"}
            </Button>

            {app.repositoryUrl && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setBranchInput(app.branch || "main");
                  setShowBranchModal(true);
                }}
                disabled={
                  app.status === "building" || app.status === "deploying"
                }
                title="Deploy from a specific branch"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <ChevronDown className="w-3 h-3 -ml-1" />
              </Button>
            )}
          </div>
        )}
      </div>

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
          <GeneralTab app={app} applicationId={applicationId} />
        )}
        {activeTab === "env" && (
          <EnvVarsTab app={app} applicationId={applicationId} />
        )}
        {activeTab === "domains" && (
          <DomainsTab app={app} applicationId={applicationId} />
        )}
        {activeTab === "deployments" && (
          <DeploymentsTab applicationId={applicationId} />
        )}
        {activeTab === "logs" && <LogsTab app={app} />}
        {activeTab === "terminal" && (
          <Suspense
            fallback={
              <div className="text-sm text-text-muted p-6">
                Loading terminal...
              </div>
            }
          >
            <TerminalTab app={app} />
          </Suspense>
        )}
        {activeTab === "monitoring" && (
          <MonitoringTab applicationId={applicationId} />
        )}
        {activeTab === "security" && (
          <SecurityTab applicationId={applicationId} />
        )}
        {activeTab === "previews" && (
          <PreviewsTab app={app} applicationId={applicationId} />
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate({ id: applicationId })}
        title="Delete Application"
        description={`This will permanently delete "${app.name}" and stop its container. All deployment history will be lost.`}
        confirmText="Delete Application"
        isPending={deleteMutation.isPending}
      />

      <Modal
        open={showBranchModal}
        onClose={() => {
          setShowBranchModal(false);
          setBranchInput("");
        }}
        title="Deploy from branch"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Deploy any branch without changing the app's default branch. The
            running container will be replaced.
          </p>

          <Input
            label="Branch name"
            value={branchInput}
            onChange={(e) => setBranchInput(e.target.value)}
            placeholder={app.branch || "main"}
            autoComplete="off"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && branchInput.trim()) {
                deployBranchMutation.mutate({
                  id: applicationId,
                  branch: branchInput.trim(),
                });
              }
            }}
          />

          {deployBranchMutation.error && (
            <p className="text-xs text-danger">
              {deployBranchMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => {
                setShowBranchModal(false);
                setBranchInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                deployBranchMutation.mutate({
                  id: applicationId,
                  branch: branchInput.trim(),
                })
              }
              disabled={!branchInput.trim() || deployBranchMutation.isPending}
            >
              <Rocket className="w-3.5 h-3.5" />
              {deployBranchMutation.isPending ? "Queuing…" : "Deploy branch"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
