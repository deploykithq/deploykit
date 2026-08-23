import { memo } from "react";
import { ArrowRight, CheckCircle2, Copy } from "lucide-react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Select } from "@shared/components/select";

import { ServerSelector } from "@project/infrastructure/ui/components/ServerSelector";

import { useDeployTemplate } from "@templates/infrastructure/ui/hooks/useDeployTemplate";

import type {
  DeployResultViewPropsI,
  DeployTemplateModalPropsI,
} from "@templates/infrastructure/ui/interfaces/templates.interfaces";

export const DeployTemplateModal: React.FC<DeployTemplateModalPropsI> = memo(
  function DeployTemplateModal({ template, open, onClose, projectId }) {
    const {
      name,
      setName,
      selectedProject,
      setSelectedProject,
      serverId,
      setServerId,
      result,
      effectiveProjectId,
      projectOptions,
      noProjects,
      deploying,
      close,
      handleSubmit,
      goToApp,
      goToProject,
    } = useDeployTemplate({ template, open, onClose, projectId });

    if (!template) return null;

    return (
      <Modal open={open} onClose={close} title={`Deploy ${template.name}`}>
        {result ? (
          <DeployResultView
            result={result}
            onGoToApp={goToApp}
            onGoToProject={goToProject}
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
                disabled={deploying || !name.trim() || !effectiveProjectId}
              >
                {deploying ? "Deploying…" : "Deploy"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    );
  },
);

const DeployResultView: React.FC<DeployResultViewPropsI> = ({
  result,
  onGoToApp,
  onGoToProject,
}) => {
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
