import { memo } from "react";
import { FolderKanban, Plus, ChevronRight } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { EmptyState } from "@shared/components/empty-state";

import { APP_STATUS_DOT } from "@dashboard/infrastructure/ui/constants/dashboard.constants";
import type { DashboardProjectI } from "@dashboard/infrastructure/ui/interfaces/dashboard.interfaces";

interface ProjectListPropsI {
  projects: DashboardProjectI[];
  totalCount: number;
  onCreateProject: () => void;
}

export const ProjectList: React.FC<ProjectListPropsI> = memo(
  function ProjectList({ projects, totalCount, onCreateProject }) {
    const navigate = useNavigate();

    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-secondary flex items-center gap-2">
            <FolderKanban className="w-3.5 h-3.5" />
            Projects
          </h2>
          <span className="text-xs text-text-muted">{totalCount} total</span>
        </div>

        {!projects.length ? (
          <Card>
            <EmptyState
              icon={<FolderKanban className="w-6 h-6" />}
              title="No projects yet"
              description="Create your first project to start deploying."
              action={
                <Button onClick={onCreateProject} size="sm">
                  <Plus className="w-3.5 h-3.5" />
                  Create Project
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => {
              const running = project.applications.filter(
                (a) => a.status === "running",
              ).length;
              const errors = project.applications.filter(
                (a) => a.status === "error" || a.status === "stopped",
              ).length;

              return (
                <Card
                  key={project.id}
                  hoverable
                  onClick={() =>
                    navigate({
                      to: "/projects/$projectId",
                      params: { projectId: project.id },
                    })
                  }
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center shrink-0">
                      <FolderKanban className="w-4 h-4 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {project.name}
                        </span>
                        {errors > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger">
                            {errors} error
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">
                        {running}/{project.applications.length} apps running ·{" "}
                        {project.databases.length} db
                        {project.databases.length !== 1 ? "s" : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {project.applications.slice(0, 5).map((app) => (
                        <span
                          key={app.id}
                          className={`w-2 h-2 rounded-full ${APP_STATUS_DOT[app.status] || "bg-neutral-500"}`}
                          title={`${app.name}: ${app.status}`}
                        />
                      ))}
                    </div>

                    <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    );
  },
);
