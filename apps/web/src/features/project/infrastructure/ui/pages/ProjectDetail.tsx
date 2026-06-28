import { memo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, Box, Database, Trash2 } from "lucide-react";

import { projectDetailRoute } from "@/router";

import { useAuthStore } from "@lib/auth";

import { Button, Card, EmptyState, ConfirmDialog } from "@shared/components";
import {
  ApplicationCard,
  DatabaseCard,
  NewApplicationModal,
  NewDatabaseModal,
  NotificationsSection,
  StatusPageSection,
  MembersSection,
} from "@project/infrastructure/ui/components";

import { trpc } from "@lib/trpc";
import type { ProjectI } from "@project/infrastructure/ui/interfaces/project.module.interfaces";

export const ProjectDetailPage: React.FC = memo(function ProjectDetailPage() {
  const { projectId } = projectDetailRoute.useParams();
  const navigate = useNavigate();
  const onBack = () => navigate({ to: "/" });
  const onOpenService = (type: "application" | "database", id: string) => {
    if (type === "application") {
      navigate({
        to: "/projects/$projectId/apps/$appId",
        params: { projectId, appId: id },
      });
    } else {
      navigate({
        to: "/projects/$projectId/db/$dbId",
        params: { projectId, dbId: id },
      });
    }
  };
  const utils = trpc.useUtils();
  const [showNewApp, setShowNewApp] = useState(false);
  const [showNewDb, setShowNewDb] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canWrite = useAuthStore((s) => s.canWrite)();
  const isAdmin = useAuthStore((s) => s.isAdmin)();

  const { data: rawProject, isLoading } = trpc.project.byId.useQuery({
    id: projectId,
  });

  const project = rawProject as ProjectI | undefined;

  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      onBack();
    },
  });

  const handleAppCreated = () => {
    setShowNewApp(false);
    utils.project.byId.invalidate({ id: projectId });
  };

  const handleDbCreated = () => {
    setShowNewDb(false);
    utils.project.byId.invalidate({ id: projectId });
  };

  if (isLoading)
    return <div className="text-sm text-text-muted p-6">Loading...</div>;
  if (!project)
    return <div className="text-sm text-danger p-6">Project not found</div>;

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
          <h1 className="text-xl font-semibold">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-text-secondary mt-0.5">
              {project.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          )}
          {canWrite && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowNewDb(true)}
            >
              <Database className="w-3.5 h-3.5" />
              Add Database
            </Button>
          )}
          {canWrite && (
            <Button size="sm" onClick={() => setShowNewApp(true)}>
              <Plus className="w-3.5 h-3.5" />
              Add Application
            </Button>
          )}
        </div>
      </div>

      {/* Applications */}
      <section>
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
          Applications
        </h2>
        {!project.applications.length ? (
          <Card>
            <EmptyState
              icon={<Box className="w-6 h-6" />}
              title="No applications"
              description="Add an application from a Git repo or Docker image."
              action={
                canWrite ? (
                  <Button size="sm" onClick={() => setShowNewApp(true)}>
                    <Plus className="w-3.5 h-3.5" />
                    Add Application
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {project.applications.map((app) => (
              <ApplicationCard
                key={app.id}
                app={app}
                onClick={() => onOpenService("application", app.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Databases */}
      <section>
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
          Databases
        </h2>
        {!project.databases.length ? (
          <Card>
            <EmptyState
              icon={<Database className="w-6 h-6" />}
              title="No databases"
              description="Create a managed database (PostgreSQL, MongoDB, Redis, etc.)."
              action={
                canWrite ? (
                  <Button size="sm" onClick={() => setShowNewDb(true)}>
                    <Plus className="w-3.5 h-3.5" />
                    Add Database
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {project.databases.map((db) => (
              <DatabaseCard
                key={db.id}
                db={db}
                onClick={() => onOpenService("database", db.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Notifications */}
      <NotificationsSection projectId={projectId} />

      {/* Status Page */}
      <StatusPageSection project={project} />

      {/* Members */}
      <MembersSection projectId={projectId} />

      {/* Modals */}
      <NewApplicationModal
        open={showNewApp}
        onClose={() => setShowNewApp(false)}
        projectId={projectId}
        onCreated={handleAppCreated}
      />

      <NewDatabaseModal
        open={showNewDb}
        onClose={() => setShowNewDb(false)}
        projectId={projectId}
        onCreated={handleDbCreated}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate({ id: projectId })}
        title="Delete Project"
        description={`This will permanently delete "${project.name}" and all its applications, databases, and deployments. All running containers will be stopped.`}
        confirmText="Delete Project"
        isPending={deleteMutation.isPending}
      />
    </div>
  );
});
