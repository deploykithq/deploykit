import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle, Github } from "lucide-react";

import { Button } from "@shared/components/button";

import { SectionCard } from "@settings/infrastructure/ui/components";

import { trpc } from "@lib/trpc";

export const GitHubAppSection: React.FC = memo(function GitHubAppSection() {
  const { data, isLoading } = trpc.github.status.useQuery();

  const installations = data?.installations.length ?? 0;

  return (
    <SectionCard icon={Github} title="GitHub App">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Connect repositories from a list instead of pasting an access token.
          The App registers its own webhook, clones with a credential that
          expires in an hour, and reports every deploy back on the commit.
        </p>

        {!isLoading && (
          <div className="rounded-lg bg-surface-2 border border-border px-3 py-2">
            {data?.configured && data.app ? (
              <p className="text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-success shrink-0" />
                <span className="truncate">{data.app.name}</span>
                <span className="text-xs text-text-muted shrink-0">
                  {installations === 0
                    ? "not installed yet"
                    : `${installations} installation${installations === 1 ? "" : "s"}`}
                </span>
              </p>
            ) : (
              <p className="text-sm text-text-secondary">
                No GitHub App is configured on this instance.
              </p>
            )}
          </div>
        )}

        <Link to="/settings/github">
          <Button variant="secondary" size="sm">
            <Github className="w-3.5 h-3.5" />
            {data?.configured ? "Manage" : "Set up"}
          </Button>
        </Link>
      </div>
    </SectionCard>
  );
});
