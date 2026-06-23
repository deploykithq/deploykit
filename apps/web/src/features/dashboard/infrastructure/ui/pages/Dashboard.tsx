import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Box, Database, Server, Bell, Loader2 } from "lucide-react";

import { Button, Modal, Input } from "@shared/components";
import {
  StatCard,
  RecentDeploys,
  ProjectList,
  ActivityFeed,
  ServerOverview,
  OnboardingWizard,
} from "@dashboard/infrastructure/ui/components";

import { trpc } from "@lib/trpc";
import { useServiceUpdates } from "@lib/socket";

export const DashboardPage = () => {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  useServiceUpdates();

  const { data, isLoading } = trpc.dashboard.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const createMutation = trpc.project.create.useMutation({
    onSuccess: (project) => {
      utils.dashboard.summary.invalidate();
      utils.project.list.invalidate();
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      navigate({
        to: "/projects/$projectId",
        params: { projectId: project.id },
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const { stats, projects, servers, recentDeploys, recentActivity } = data!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {stats.deploys24h > 0
              ? `${stats.deploys24h} deploy${stats.deploys24h !== 1 ? "s" : ""} in the last 24h`
              : "Overview of all your deployments"}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" />
          New Project
        </Button>
      </div>

      {/* First-run onboarding (hidden once anything is deployed) */}
      <OnboardingWizard
        stats={{
          servers: stats.servers,
          projects: stats.projects,
          applications: stats.applications,
          databases: stats.databases,
        }}
        onCreateProject={() => setShowCreate(true)}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Applications"
          value={`${stats.appsRunning}/${stats.applications}`}
          sub="running"
          icon={Box}
          accent={stats.appsError > 0 ? "danger" : "default"}
          badge={
            stats.appsError > 0
              ? `${stats.appsError} error`
              : stats.appsBuilding > 0
                ? `${stats.appsBuilding} building`
                : undefined
          }
        />
        <StatCard
          label="Databases"
          value={`${stats.dbsRunning}/${stats.databases}`}
          sub="running"
          icon={Database}
        />
        <StatCard
          label="Servers"
          value={`${stats.serversConnected}/${stats.servers}`}
          sub="connected"
          icon={Server}
          accent={
            stats.servers > 0 && stats.serversConnected < stats.servers
              ? "warning"
              : "default"
          }
        />
        <StatCard
          label="Alerts"
          value={stats.openAlerts}
          sub={`${stats.deploys7d} deploys (7d)`}
          icon={Bell}
          accent={stats.openAlerts > 0 ? "danger" : "default"}
          onClick={() => navigate({ to: "/alerts" })}
        />
      </div>

      {/* Main Content: Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          <RecentDeploys deploys={recentDeploys} deploys7d={stats.deploys7d} />
          <ProjectList
            projects={projects}
            totalCount={stats.projects}
            onCreateProject={() => setShowCreate(true)}
          />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <ActivityFeed entries={recentActivity} />
          <ServerOverview servers={servers} />
        </div>
      </div>

      {/* Create Project Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Project"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            createMutation.mutate({
              name: newName.trim(),
              description: newDesc.trim() || undefined,
            });
          }}
          className="space-y-4"
        >
          <Input
            label="Project Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="my-project"
            required
            autoFocus
          />
          <Input
            label="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="A brief description of your project"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !newName.trim()}
            >
              {createMutation.isPending ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
