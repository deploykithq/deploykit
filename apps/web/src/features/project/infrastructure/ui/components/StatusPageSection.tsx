import { memo } from "react";
import { ExternalLink, Globe } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { Input } from "@shared/components/input";

import { useStatusPageSection } from "@project/infrastructure/ui/hooks/useStatusPageSection";

import type { ProjectI } from "@project/infrastructure/ui/interfaces/project.interfaces";

interface StatusPageSectionPropsI {
  project: ProjectI;
}

export const StatusPageSection: React.FC<StatusPageSectionPropsI> = memo(
  function StatusPageSection({ project }) {
    const {
      canWrite,
      enabled,
      setEnabled,
      slug,
      setSlug,
      title,
      setTitle,
      error,
      updateStatusPage,
      updateApp,
      save,
      publicUrl,
    } = useStatusPageSection(project);

    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Status Page
          </h2>
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              View <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <Card>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Globe className="w-5 h-5 text-text-muted mt-0.5 shrink-0" />
              <p className="text-xs text-text-secondary flex-1">
                Publish a public, no-login status page showing the live state and
                uptime of selected applications in this project.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                disabled={!canWrite}
                onChange={(e) => setEnabled(e.target.checked)}
                className="accent-accent"
              />
              Enable public status page
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Slug (URL)"
                placeholder="my-team"
                value={slug}
                disabled={!canWrite}
                onChange={(e) =>
                  setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))
                }
              />
              <Input
                label="Title (optional)"
                placeholder={project.name}
                value={title}
                disabled={!canWrite}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {slug && (
              <p className="text-[11px] text-text-muted">
                Public URL: {window.location.origin}/status/{slug}
              </p>
            )}

            {error && <p className="text-xs text-danger">{error}</p>}

            {canWrite && (
              <Button
                size="sm"
                onClick={save}
                disabled={updateStatusPage.isPending}
              >
                {updateStatusPage.isPending ? "Saving…" : "Save"}
              </Button>
            )}

            {/* Per-application visibility */}
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs font-medium text-text-secondary">
                Applications shown publicly
              </p>
              {project.applications.length === 0 ? (
                <p className="text-xs text-text-muted">
                  No applications in this project.
                </p>
              ) : (
                project.applications.map((app) => (
                  <label
                    key={app.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={!!app.statusPageVisible}
                      disabled={!canWrite || updateApp.isPending}
                      onChange={(e) =>
                        updateApp.mutate({
                          id: app.id,
                          statusPageVisible: e.target.checked,
                        })
                      }
                      className="accent-accent"
                    />
                    {app.name}
                  </label>
                ))
              )}
            </div>
          </div>
        </Card>
      </section>
    );
  },
);
