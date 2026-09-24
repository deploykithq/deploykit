import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle, Github, Loader2 } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { trpc } from "@lib/trpc";

/**
 * Where GitHub returns to, twice.
 *
 * After creating the App it comes back with `code` and `state`, which are
 * exchanged for the App's credentials. After installing it, GitHub returns
 * again with `installation_id` — recording the installation here rather than
 * waiting for the webhook is what makes the flow complete even when the
 * webhook cannot reach this instance.
 */
export const GitHubCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth/settings/github/callback" });
  const utils = trpc.useUtils();

  const [error, setError] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  // Strict mode mounts effects twice; the code is single-use, so guard it.
  const started = useRef<boolean>(false);

  const completeManifest = trpc.github.completeManifest.useMutation({
    onError: (err) => setError(err.message),
    onSuccess: (res) => {
      utils.github.status.invalidate();
      setInstallUrl(res.installUrl);
    },
  });

  const syncInstallation = trpc.github.syncInstallation.useMutation({
    onError: (err) => setError(err.message),
    onSuccess: () => {
      utils.github.status.invalidate();
      navigate({ to: "/settings/github" });
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (search.code && search.state) {
      completeManifest.mutate({ code: search.code, state: search.state });
      return;
    }

    if (search.installation_id) {
      const installationId = Number(search.installation_id);
      if (Number.isFinite(installationId)) {
        syncInstallation.mutate({ installationId });
        return;
      }
    }

    navigate({ to: "/settings/github" });
    // Runs once on mount; the guard above is the real control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-xl">
      <Card>
        <div className="space-y-4">
          <h1 className="text-sm font-medium flex items-center gap-2">
            <Github className="w-4 h-4" />
            Connecting to GitHub
          </h1>

          {error && (
            <>
              <p className="text-sm text-danger flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                {error}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate({ to: "/settings/github" })}
              >
                Back to settings
              </Button>
            </>
          )}

          {!error && installUrl && (
            <>
              <p className="text-sm text-text-secondary flex items-start gap-1.5">
                <CheckCircle className="w-4 h-4 text-success shrink-0 mt-px" />
                The App is registered. Install it on the account that owns the
                repositories you want to deploy.
              </p>
              <div className="flex items-center gap-2">
                <a href={installUrl}>
                  <Button size="sm">
                    <Github className="w-3.5 h-3.5" />
                    Install the App
                  </Button>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate({ to: "/settings/github" })}
                >
                  Later
                </Button>
              </div>
            </>
          )}

          {!error && !installUrl && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Finishing up...
            </p>
          )}
        </div>
      </Card>
    </div>
  );
};
