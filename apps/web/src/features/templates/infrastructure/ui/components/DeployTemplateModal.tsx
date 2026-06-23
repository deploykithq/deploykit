import { memo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Copy } from "lucide-react";
import type { Template } from "@deploykit/shared";

import { Modal, Button, Input, Select } from "@shared/components";
import { ServerSelector } from "@project/infrastructure/ui/components/ServerSelector";

import { trpc } from "@lib/trpc";

interface DeployTemplateModalPropsI {
  template: Template | null;
  open: boolean;
  onClose: () => void;
  /** Preselect a project (e.g. when launched from a project page). */
  projectId?: string;
}

type DeployResult = {
  projectId: string;
  primaryApplicationId: string | null;
  applications: { id: string; name: string; deployed: boolean }[];
  databases: { id: string; name: string; connectionString: string }[];
};

export const DeployTemplateModal: React.FC<DeployTemplateModalPropsI> = memo(
  function DeployTemplateModal({ template, open, onClose, projectId }) {
    const navigate = useNavigate();
    const utils = trpc.useUtils();

    const [name, setName] = useState<string>("");
    const [selectedProject, setSelectedProject] = useState<string>(
      projectId ?? "",
    );
    const [serverId, setServerId] = useState<string | null>(null);
    const [result, setResult] = useState<DeployResult | null>(null);

    const projectsQuery = trpc.project.list.useQuery(undefined, {
      enabled: open && !projectId,
    });

    const deployMutation = trpc.template.deploy.useMutation({
      onSuccess: (data) => {
        utils.dashboard.summary.invalidate();
        utils.project.list.invalidate();
        utils.project.byId.invalidate({ id: data.projectId });
        setResult(data);
      },
      onError: (err) => alert(err.message),
    });

    const effectiveProjectId = projectId ?? selectedProject;

    const close = () => {
      setName("");
      setResult(null);
      setServerId(null);
      if (!projectId) setSelectedProject("");
      deployMutation.reset();
      onClose();
    };

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!template || !effectiveProjectId) return;
      deployMutation.mutate({
        templateId: template.id,
        projectId: effectiveProjectId,
        name: name.trim(),
        serverId: serverId ?? undefined,
      });
    };

    if (!template) return null;

    const projectOptions = [
      { value: "", label: "Select a project…" },
      ...(projectsQuery.data ?? []).map((p) => ({
        value: p.id,
        label: p.name,
      })),
    ];

    const noProjects =
      !projectId && projectsQuery.isSuccess && projectOptions.length === 1;

    return (
      <Modal open={open} onClose={close} title={`Deploy ${template.name}`}>
        {result ? (
          <DeployResultView
            result={result}
            onGoToApp={(pid, appId) => {
              close();
              navigate({
                to: "/projects/$projectId/apps/$appId",
                params: { projectId: pid, appId },
              });
            }}
            onGoToProject={(pid) => {
              close();
              navigate({
                to: "/projects/$projectId",
                params: { projectId: pid },
              });
            }}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-xs text-text-secondary">{template.description}</p>

            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={template.id}
              required
              autoFocus
            />
            <p className="text-[11px] text-text-muted -mt-2">
              Lowercase letters, numbers and hyphens. Used to name the created
              resources.
            </p>

            {!projectId &&
              (noProjects ? (
                <p className="text-xs text-warning">
                  You need a project first. Create one from the dashboard, then
                  come back.
                </p>
              ) : (
                <Select
                  label="Project"
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  options={projectOptions}
                />
              ))}

            <ServerSelector value={serverId} onChange={setServerId} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  deployMutation.isPending ||
                  !name.trim() ||
                  !effectiveProjectId
                }
              >
                {deployMutation.isPending ? "Deploying…" : "Deploy"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    );
  },
);

const DeployResultView: React.FC<{
  result: DeployResult;
  onGoToApp: (projectId: string, appId: string) => void;
  onGoToProject: (projectId: string) => void;
}> = ({ result, onGoToApp, onGoToProject }) => {
  const primaryApp =
    result.applications.find((a) => a.id === result.primaryApplicationId) ??
    result.applications[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-success">
        <CheckCircle2 className="w-5 h-5" />
        <span className="text-sm font-medium">Resources created</span>
      </div>

      {result.applications.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-secondary">
            Applications
          </p>
          {result.applications.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between text-sm bg-surface-2 rounded-lg px-3 py-2"
            >
              <span>{a.name}</span>
              <span className="text-xs text-text-muted">
                {a.deployed ? "deploying…" : "ready to deploy"}
              </span>
            </div>
          ))}
        </div>
      )}

      {result.databases.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-secondary">Databases</p>
          {result.databases.map((d) => (
            <div key={d.id} className="bg-surface-2 rounded-lg px-3 py-2">
              <div className="text-sm mb-1">{d.name}</div>
              {d.connectionString && (
                <div className="flex items-center gap-2">
                  <code className="text-[11px] text-text-muted break-all flex-1">
                    {d.connectionString}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard?.writeText(d.connectionString)
                    }
                    className="text-text-muted hover:text-text-primary shrink-0"
                    title="Copy connection string"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {primaryApp ? (
          <Button onClick={() => onGoToApp(result.projectId, primaryApp.id)}>
            Open application
            <ArrowRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button onClick={() => onGoToProject(result.projectId)}>
            Open project
            <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
};
