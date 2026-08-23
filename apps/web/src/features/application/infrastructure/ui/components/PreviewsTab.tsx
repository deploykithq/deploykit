import { memo } from "react";
import { Globe, GitBranch, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { StatusBadge } from "@shared/components/status-badge";
import { CopyableField } from "./CopyableField";

import { usePreviewsTab } from "@application/infrastructure/ui/hooks/usePreviewsTab";

import { timeAgo } from "@lib/utils";

interface PreviewsTabPropsI {
  app: any;
  applicationId: string;
}

export const PreviewsTab: React.FC<PreviewsTabPropsI> = memo(
  function PreviewsTab({ app, applicationId }) {
    const { previews, isLoading, deleting, deletePreview } =
      usePreviewsTab(applicationId);

    if (!app.previewEnabled) {
      return (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <GitBranch className="w-8 h-8 text-text-muted" />
            <div>
              <p className="text-sm font-medium">
                Preview deployments disabled
              </p>
              <p className="text-xs text-text-muted mt-1">
                Enable "Auto-deploy pull requests" in the General tab, then push
                a webhook from GitHub or GitLab.
              </p>
            </div>
          </div>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {/* Config summary */}
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
              <GitBranch className="w-4 h-4 text-success" />
            </div>
            <div>
              <p className="text-sm font-medium">Preview deployments active</p>
              <p className="text-xs text-text-muted mt-0.5">
                Pull requests on{" "}
                <code className="font-mono">
                  {app.repositoryUrl?.replace(/https?:\/\//, "")}
                </code>{" "}
                will deploy automatically.
                {app.previewDomain && (
                  <>
                    {" "}
                    URL pattern:{" "}
                    <code className="font-mono">pr-N.{app.previewDomain}</code>
                  </>
                )}
              </p>
            </div>
          </div>
        </Card>

        {/* Webhook reminder */}
        <Card>
          <p className="text-xs font-medium text-text-secondary mb-2">
            Webhook URL — add to your repo for PR events
          </p>
          <CopyableField
            value={`${window.location.origin}/api/webhooks/github`}
          />
          <p className="text-[11px] text-text-muted mt-1.5">
            GitHub: Settings → Webhooks → select <strong>Pull requests</strong>{" "}
            events. GitLab: Settings → Webhooks → select{" "}
            <strong>Merge request</strong> events.
          </p>
        </Card>

        {/* Preview list */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium">
              Active previews{" "}
              <span className="text-text-muted font-normal">
                ({previews?.length ?? 0})
              </span>
            </h3>
          </div>

          {isLoading ? (
            <p className="text-sm text-text-muted px-4 py-6 text-center">
              Loading…
            </p>
          ) : !previews?.length ? (
            <p className="text-sm text-text-muted px-4 py-8 text-center">
              No active previews. Open a pull request to trigger one.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {previews.map((preview) => {
                const lastDeploy = preview.deployments?.[0];
                const domain = preview.domains?.[0];

                return (
                  <div
                    key={preview.id}
                    className="flex items-center gap-3 px-4 py-3 flex-wrap sm:flex-nowrap"
                  >
                    <div className="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                      <span className="text-xs font-mono font-medium text-text-secondary">
                        #{preview.previewPrNumber}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {preview.previewBranch}
                        </span>
                        <StatusBadge status={preview.status} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {domain && (
                          <a
                            href={`http://${domain.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-accent hover:underline flex items-center gap-1"
                          >
                            <Globe className="w-3 h-3" />
                            {domain.domain}
                          </a>
                        )}
                        {lastDeploy?.commitHash && (
                          <span className="text-xs font-mono text-text-muted">
                            {lastDeploy.commitHash}
                          </span>
                        )}
                        <span className="text-xs text-text-muted">
                          {timeAgo(preview.updatedAt)}
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => deletePreview({ id: preview.id })}
                      disabled={deleting}
                      title="Delete preview environment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    );
  },
);
