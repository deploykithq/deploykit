import { lazy, Suspense } from "react";
import {
  ArrowLeft,
  GitBranch,
  ChevronDown,
  Play,
  Square,
  Rocket,
  Trash2,
  Construction,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { StatusBadge } from "@shared/components/status-badge";
import { Textarea } from "@shared/components/textarea";
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

import { TasksTab } from "@task/infrastructure/ui/components";

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
    showMaintenanceModal,
    setShowMaintenanceModal,
    openMaintenanceModal,
    maintenanceMessage,
    setMaintenanceMessage,
    maintenanceMutation,
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
            {app.maintenanceEnabled && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning bg-warning/10 px-2 py-0.5 rounded-full">
                <Construction className="w-3 h-3" />
                Maintenance
              </span>
            )}
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

            {!app.maintenanceEnabled && (
              <Button
                variant="secondary"
                size="sm"
                onClick={openMaintenanceModal}
                title="Show a maintenance page on this app's domains"
              >
                <Construction className="w-3.5 h-3.5" />
                Maintenance
              </Button>
            )}

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

      {app.maintenanceEnabled && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <Construction className="w-4 h-4 text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-warning">
              Maintenance mode is on
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              Visitors to this app's domains see a maintenance page (HTTP 503).
              It stays on across deploys until you turn it off.
            </p>
            {maintenanceMutation.error && !showMaintenanceModal && (
              <p className="text-xs text-danger mt-1">
                {maintenanceMutation.error.message}
              </p>
            )}
          </div>
          {canOperate && (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={openMaintenanceModal}
              >
                Edit message
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  maintenanceMutation.mutate({
                    id: applicationId,
                    enabled: false,
                  })
                }
                disabled={maintenanceMutation.isPending}
              >
                {maintenanceMutation.isPending ? "Turning off…" : "Turn off"}
              </Button>
            </div>
          )}
        </div>
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
        {activeTab === "tasks" && (
          <TasksTab target={{ kind: "application", id: applicationId }} />
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
        open={showMaintenanceModal}
        onClose={() => setShowMaintenanceModal(false)}
        title={
          app.maintenanceEnabled ? "Maintenance message" : "Enable maintenance mode"
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Every domain of this app will answer with a maintenance page
            (HTTP 503) until you turn it off. The app keeps running and can be
            deployed in the meantime.
          </p>

          <Textarea
            label="Message (optional)"
            value={maintenanceMessage}
            onChange={(e) => setMaintenanceMessage(e.target.value)}
            placeholder="We are performing scheduled maintenance. We will be back shortly."
            rows={3}
            maxLength={500}
            autoFocus
          />

          {maintenanceMutation.error && (
            <p className="text-xs text-danger">
              {maintenanceMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => setShowMaintenanceModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                maintenanceMutation.mutate({
                  id: applicationId,
                  enabled: true,
                  message: maintenanceMessage.trim() || undefined,
                })
              }
              disabled={maintenanceMutation.isPending}
            >
              <Construction className="w-3.5 h-3.5" />
              {maintenanceMutation.isPending
                ? "Applying…"
                : app.maintenanceEnabled
                  ? "Update message"
                  : "Enable maintenance"}
            </Button>
          </div>
        </div>
      </Modal>

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
