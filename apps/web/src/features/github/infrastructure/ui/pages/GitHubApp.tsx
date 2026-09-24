import { useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  Github,
  Link2,
  Plug,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { Input } from "@shared/components/input";
import { FormStatus } from "@shared/components/form-status";
import { ConfirmDialog } from "@shared/components/confirm-dialog";

import { useGitHubApp } from "@github/infrastructure/ui/hooks/useGitHubApp";

/** Paste the credentials of an App that already exists on GitHub. */
const ManualConnect: React.FC<{
  connect: ReturnType<typeof useGitHubApp>["connectExisting"];
}> = ({ connect }) => {
  const [appId, setAppId] = useState<string>("");
  const [privateKey, setPrivateKey] = useState<string>("");
  const [webhookSecret, setWebhookSecret] = useState<string>("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    connect.mutate({
      appId: Number(appId),
      privateKey,
      webhookSecret,
    });
  };

  return (
    <details className="rounded-lg border border-border bg-surface-2 p-3">
      <summary className="text-xs font-medium text-text-secondary cursor-pointer">
        Already created an App? Connect it manually
      </summary>

      <form onSubmit={submit} className="mt-3 space-y-3">
        <Input
          label="App ID"
          type="number"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          placeholder="123456"
          required
        />
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            Private key (.pem)
          </label>
          <textarea
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            rows={5}
            required
            placeholder="-----BEGIN RSA PRIVATE KEY-----"
            className="w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            Webhook secret
          </label>
          <input
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            required
            autoComplete="new-password"
            className="w-full px-3 py-2 rounded-lg bg-surface-1 border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <Button type="submit" size="sm" disabled={connect.isPending}>
          <Plug className="w-3.5 h-3.5" />
          Connect
        </Button>
        <p className="text-[11px] text-text-muted">
          The App's webhook URL must point at this instance, and it needs the
          contents, statuses and pull requests permissions.
        </p>
      </form>
    </details>
  );
};

export const GitHubAppPage: React.FC = () => {
  const {
    status,
    loading,
    organization,
    setOrganization,
    appName,
    setAppName,
    register,
    registering,
    connectExisting,
    test,
    syncInstallations,
    disconnect,
    error,
    notice,
  } = useGitHubApp();

  const [confirmRemove, setConfirmRemove] = useState<boolean>(false);

  if (loading) {
    return <div className="text-sm text-text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Github className="w-5 h-5" />
          GitHub App
        </h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Connect repositories without pasting an access token. Pushes and pull
          requests arrive automatically, and DeployKit reports each deploy back
          on the commit.
        </p>
      </div>

      {!status?.configured && (
        <Card>
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Registering creates a private GitHub App owned by you. DeployKit
              never sees your GitHub password, and the App only reaches the
              repositories you install it on.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="App name (optional)"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="DeployKit - your-host"
              />
              <Input
                label="Organization (optional)"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="acme-inc"
              />
            </div>
            <p className="text-[11px] text-text-muted">
              Leave the organization empty to create the App on your personal
              account. Creating it inside an organization needs owner rights
              there — otherwise GitHub falls back to your own account.
            </p>

            <div className="flex items-center gap-2">
              <Button onClick={register} disabled={registering}>
                <Github className="w-4 h-4" />
                Register on GitHub
              </Button>
              <FormStatus success={!!notice} successMessage={notice ?? ""} error={error} />
            </div>

            <ManualConnect connect={connectExisting} />
          </div>
        </Card>
      )}

      {status?.configured && status.app && (
        <>
          <Card>
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-success" />
                    {status.app.name}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    App ID {status.app.appId}
                    {status.app.ownerLogin
                      ? ` - owned by ${status.app.ownerLogin}`
                      : ""}
                  </p>
                </div>
                {status.app.htmlUrl && (
                  <a
                    href={status.app.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent hover:underline shrink-0"
                  >
                    Open on GitHub
                  </a>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => test.mutate()}
                  disabled={test.isPending}
                >
                  <Plug className="w-3.5 h-3.5" />
                  Test connection
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => syncInstallations.mutate()}
                  disabled={syncInstallations.isPending}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh installations
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Disconnect
                </Button>
                <FormStatus
                  success={!!notice}
                  successMessage={notice ?? ""}
                  error={error}
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-medium">Installations</h2>
                {status.installUrl && (
                  <a
                    href={status.installUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent hover:underline"
                  >
                    Install on an account
                  </a>
                )}
              </div>

              {status.installations.length === 0 ? (
                <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-1.5">
                  <p className="text-sm text-text-secondary">
                    The App is registered but not installed anywhere yet.
                  </p>
                  <p className="text-xs text-text-muted">
                    Install it on the account that owns the repositories you
                    want to deploy, and pick only those repositories.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {status.installations.map((inst) => (
                    <li
                      key={inst.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm flex items-center gap-1.5 truncate">
                          <Building2 className="w-3.5 h-3.5 text-text-muted shrink-0" />
                          {inst.accountLogin}
                          {inst.suspended && (
                            <span className="text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                              suspended
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-text-muted mt-0.5">
                          {inst.repositorySelection === "all"
                            ? "All repositories"
                            : "Selected repositories"}
                        </p>
                      </div>
                      <a
                        href={inst.settingsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:underline flex items-center gap-1 shrink-0"
                      >
                        <Link2 className="w-3 h-3" />
                        Configure
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-[11px] text-text-muted flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                Granting access to selected repositories rather than all of them
                keeps the blast radius of the App's private key small.
              </p>
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Disconnect the GitHub App?"
        description="Applications deploying through it lose their credentials until you reconnect or set an access token. The App itself stays on GitHub; delete it there if you no longer want it."
        confirmText="Disconnect"
        variant="danger"
        isPending={disconnect.isPending}
        onConfirm={() => {
          setConfirmRemove(false);
          disconnect.mutate({ confirm: true });
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
};
