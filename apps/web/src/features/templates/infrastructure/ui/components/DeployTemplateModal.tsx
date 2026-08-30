import { memo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, Eye, EyeOff } from "lucide-react";

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
      domain,
      setDomain,
      selectedProject,
      setSelectedProject,
      serverId,
      setServerId,
      result,
      effectiveProjectId,
      projectOptions,
      noProjects,
      deploying,
      error,
      close,
      handleSubmit,
      goToStack,
    } = useDeployTemplate({ template, open, onClose, projectId });

    if (!template) return null;

    return (
      <Modal open={open} onClose={close} title={`Deploy ${template.name}`}>
        {result ? (
          <DeployResultView result={result} onGoToStack={goToStack} />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-xs text-text-secondary">
              {template.description}
            </p>

            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={template.id}
              required
              autoFocus
            />
            <p className="text-[11px] text-text-muted -mt-2">
              Lowercase letters, numbers and hyphens. Names the stack and every
              container in it.
            </p>

            <Input
              label="Domain (optional)"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="app.example.com"
              autoComplete="off"
            />
            <p className="text-[11px] text-text-muted -mt-2">
              Leave empty and DeployKit generates one so the stack is reachable
              without any DNS setup.
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

            {error && <p className="text-xs text-danger">{error}</p>}

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
  onGoToStack,
}) => {
  const [revealed, setRevealed] = useState(false);
  const secretEntries = Object.entries(result.secrets);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-success">
        <CheckCircle2 className="w-5 h-5" />
        <span className="text-sm font-medium">Stack created — deploying…</span>
      </div>

      {result.domains.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-secondary">URLs</p>
          {result.domains.map((d) => (
            <a
              key={d.host}
              href={`${d.https ? "https" : "http"}://${d.host}`}
              target="_blank"
              rel="noreferrer"
              className="block text-sm text-accent hover:underline bg-surface-2 rounded-lg px-3 py-2 truncate"
            >
              {d.https ? "https" : "http"}://{d.host}
            </a>
          ))}
          <p className="text-[11px] text-text-muted">
            Available once the containers finish starting.
          </p>
        </div>
      )}

      {secretEntries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-secondary">
              Generated credentials
            </p>
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded-md hover:bg-surface-2"
            >
              {revealed ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {revealed ? "Hide" : "Reveal"}
            </button>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-900/10 p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-text-secondary">
              This is the only time these are shown in full. Afterwards they
              live encrypted in the stack's environment.
            </p>
          </div>

          {secretEntries.map(([key, value]) => (
            <div key={key} className="bg-surface-2 rounded-lg px-3 py-2">
              <div className="text-[11px] text-text-muted font-mono mb-1">
                {key}
              </div>
              <div className="flex items-center gap-2">
                <code className="text-[11px] text-text-primary break-all flex-1">
                  {revealed ? value : "•".repeat(24)}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(value)}
                  className="text-text-muted hover:text-text-primary shrink-0"
                  title={`Copy ${key}`}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          onClick={() => onGoToStack(result.projectId, result.composeServiceId)}
        >
          Open stack
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
