import { memo } from "react";
import {
  CheckCircle2,
  Circle,
  FolderKanban,
  Rocket,
  Server,
  Sparkles,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { useOnboarding } from "@dashboard/infrastructure/ui/hooks/useOnboarding";

interface OnboardingStatsI {
  servers: number;
  projects: number;
  applications: number;
  databases: number;
}

interface OnboardingWizardPropsI {
  stats: OnboardingStatsI;
  onCreateProject: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardPropsI> = memo(
  function OnboardingWizard({ stats, onCreateProject }) {
    const { isAdmin, navigate, connectingLocal, connectLocalServer } =
      useOnboarding();

    // Hide once the user has provisioned anything.
    if (stats.applications > 0 || stats.databases > 0) return null;

    const hasServer = stats.servers > 0;
    const hasProject = stats.projects > 0;

    return (
      <Card className="border-accent/30 bg-accent-muted/30">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold">Welcome to DeployKit</h2>
        </div>
        <p className="text-xs text-text-secondary mb-4">
          Three quick steps to your first deployment.
        </p>

        <div className="space-y-2">
          <Step
            done={hasServer}
            icon={Server}
            title="Connect a server"
            description="Use this machine's local Docker, or add a remote server."
            action={
              hasServer ? null : isAdmin ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={connectingLocal}
                  onClick={connectLocalServer}
                >
                  {connectingLocal ? "Connecting…" : "Use local server"}
                </Button>
              ) : (
                <span className="text-[11px] text-text-muted">
                  Ask an admin
                </span>
              )
            }
          />
          <Step
            done={hasProject}
            icon={FolderKanban}
            title="Create a project"
            description="Projects group your applications and databases."
            action={
              hasProject ? null : (
                <Button size="sm" variant="secondary" onClick={onCreateProject}>
                  New project
                </Button>
              )
            }
          />
          <Step
            done={false}
            icon={Rocket}
            title="Deploy from a template"
            description="Pick a database, a self-hosted app, or a full stack."
            action={
              <Button
                size="sm"
                disabled={!hasProject}
                onClick={() => navigate({ to: "/templates" })}
              >
                Browse templates
              </Button>
            }
          />
        </div>
      </Card>
    );
  },
);

const Step: React.FC<{
  done: boolean;
  icon: React.ElementType;
  title: string;
  description: string;
  action: React.ReactNode;
}> = ({ done, icon: Icon, title, description, action }) => (
  <div className="flex items-center gap-3 bg-surface-1 border border-border rounded-lg px-3 py-2.5">
    {done ? (
      <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
    ) : (
      <Circle className="w-5 h-5 text-text-muted shrink-0" />
    )}
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <Icon className="w-4 h-4 text-text-muted shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <p className="text-[11px] text-text-secondary truncate">
          {description}
        </p>
      </div>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
