import { memo } from "react";
import {
  Cpu,
  GitBranch,
  HardDrive,
  Lock,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { Input } from "@shared/components/input";
import { Select } from "@shared/components/select";

import { CopyableField } from "@application/infrastructure/ui/components/CopyableField";

import { useGeneralTab } from "@application/infrastructure/ui/hooks/useGeneralTab";

interface GeneralTabPropsI {
  app: any;
  applicationId: string;
}

export const GeneralTab: React.FC<GeneralTabPropsI> = memo(function GeneralTab({
  app,
  applicationId,
}) {
  const {
    repoUrl,
    setRepoUrl,
    branch,
    setBranch,
    sourceToken,
    setSourceToken,
    tokenDirty,
    setTokenDirty,
    rootDirectory,
    setRootDirectory,
    volumes,
    setVolumes,
    newVolume,
    setNewVolume,
    buildType,
    setBuildType,
    dockerfilePath,
    setDockerfilePath,
    startCommand,
    setStartCommand,
    port,
    setPort,
    cpuCores,
    setCpuCores,
    memoryMb,
    setMemoryMb,
    replicas,
    setReplicas,
    hasDomain,
    autoscaleEnabled,
    setAutoscaleEnabled,
    autoscaleMin,
    setAutoscaleMin,
    autoscaleMax,
    setAutoscaleMax,
    autoscaleCpuTarget,
    setAutoscaleCpuTarget,
    autoscaleMemTarget,
    setAutoscaleMemTarget,
    instances,
    hcType,
    setHcType,
    hcPath,
    setHcPath,
    hcTimeout,
    setHcTimeout,
    hcInterval,
    setHcInterval,
    hcRetries,
    setHcRetries,
    hcRequired,
    setHcRequired,
    previewEnabled,
    setPreviewEnabled,
    previewDomain,
    setPreviewDomain,
    scanMode,
    setScanMode,
    saving,
    saveFailed,
    saveError,
    handleSave,
  } = useGeneralTab(app, applicationId);

  return (
    <Card>
      <div className="space-y-6 max-w-2xl">
        {/* Source */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Source
          </h3>

          {/* Repo URL spans full width — it's long */}
          <Input
            label="Repository URL"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/user/repo"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              autoComplete="off"
            />
            <Input
              label="Root Directory"
              value={rootDirectory}
              onChange={(e) => setRootDirectory(e.target.value)}
              placeholder="apps/web"
              autoComplete="off"
            />
          </div>

          {/* Access Token */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <Lock className="w-3 h-3" />
              Access Token
              {app.hasSourceToken && !tokenDirty && (
                <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded">
                  configured
                </span>
              )}
            </label>
            <input
              type="password"
              value={sourceToken}
              onChange={(e) => {
                setSourceToken(e.target.value);
                setTokenDirty(true);
              }}
              autoComplete="new-password"
              placeholder={
                app.hasSourceToken
                  ? "•••••••• (leave empty to keep current)"
                  : "ghp_xxxxxxxxxxxx"
              }
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
            <p className="text-[11px] text-text-muted">
              GitHub PAT, GitLab token, or any HTTPS git token. Leave empty for
              public repos.
            </p>
          </div>
        </section>

        {/* Build */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Build
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Build Type"
              value={buildType}
              onChange={(e) => setBuildType(e.target.value)}
              options={[
                { value: "nixpacks", label: "Nixpacks (auto-detect)" },
                { value: "dockerfile", label: "Dockerfile" },
                { value: "buildpacks", label: "Buildpacks" },
              ]}
            />
            <Input
              label="Port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="3000"
            />
          </div>
          {buildType === "dockerfile" && (
            <div className="space-y-1.5">
              <Input
                label="Dockerfile Path"
                value={dockerfilePath}
                onChange={(e) => setDockerfilePath(e.target.value)}
                placeholder="Dockerfile"
                autoComplete="off"
              />
              <p className="text-xs text-text-muted">
                Path to the Dockerfile, relative to the repo root (or root
                directory above). Don't prefix with <code>./</code>.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Input
              label="Start Command"
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
              placeholder={
                buildType === "nixpacks"
                  ? "npm run start:prod"
                  : "Only used by Nixpacks builds"
              }
            />
            <p className="text-xs text-text-muted">
              Override the auto-detected start command. Nixpacks only — for
              Dockerfile builds, set <code>CMD</code> in your Dockerfile.
            </p>
          </div>
        </section>

        {/* Webhook */}
        <section className="space-y-2 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Webhook
          </h3>
          <CopyableField
            value={`${window.location.origin}/api/webhooks/github`}
          />
          <p className="text-[11px] text-text-muted">
            Add this to your GitHub repo → Settings → Webhooks to auto-deploy on
            push.
          </p>
        </section>

        {/* Persistent Volumes */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <HardDrive className="w-3 h-3" />
            Persistent Volumes
          </h3>

          {volumes.map((vol, idx) => (
            <div key={idx} className="flex gap-2">
              <code className="flex-1 px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-xs font-mono text-text-primary truncate">
                {vol}
              </code>
              <button
                type="button"
                onClick={() => setVolumes(volumes.filter((_, i) => i !== idx))}
                className="px-2 py-1.5 rounded-lg text-xs text-danger hover:bg-danger/10 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}

          <div className="flex gap-2">
            <input
              type="text"
              value={newVolume}
              onChange={(e) => setNewVolume(e.target.value)}
              placeholder="/host/path:/container/path"
              className="flex-1 px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newVolume.includes(":")) {
                  e.preventDefault();
                  setVolumes([...volumes, newVolume.trim()]);
                  setNewVolume("");
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (newVolume.includes(":")) {
                  setVolumes([...volumes, newVolume.trim()]);
                  setNewVolume("");
                }
              }}
              disabled={!newVolume.includes(":")}
              className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-xs font-medium text-text-primary hover:bg-surface-3 disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
          <p className="text-[11px] text-text-muted">
            Format: /host/path:/container/path — data persists between deploys.
          </p>
        </section>

        {/* Resources */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <Cpu className="w-3 h-3" />
            Resources
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Input
                label="CPU (cores)"
                type="number"
                min={0.1}
                max={8}
                step={0.1}
                value={cpuCores}
                onChange={(e) => setCpuCores(e.target.value)}
                placeholder="unlimited"
              />
            </div>
            <div className="space-y-1.5">
              <Input
                label="Memory (MB)"
                type="number"
                min={64}
                max={32768}
                value={memoryMb}
                onChange={(e) => setMemoryMb(e.target.value)}
                placeholder="unlimited"
              />
            </div>
            <div className="space-y-1.5">
              <Input
                label="Replicas"
                type="number"
                min={1}
                max={10}
                value={replicas}
                onChange={(e) => setReplicas(e.target.value)}
                disabled={!hasDomain}
              />
            </div>
          </div>

          <p className="text-[11px] text-text-muted">
            {hasDomain
              ? "Replicas run behind the load balancer. "
              : "Add a domain to scale beyond 1 replica. "}
            Leave CPU/Memory empty for no limit. Changes apply on the next
            deploy.
          </p>

          {/* Live instance status */}
          {(instances?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {instances!.map((inst) => {
                const running = inst.state === "running";
                return (
                  <span
                    key={inst.id}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-2 border border-border text-[11px] font-mono text-text-secondary"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${running ? "bg-success" : "bg-text-muted"}`}
                    />
                    {inst.name} {inst.state}
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {/* Autoscaling */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" />
            Autoscaling
          </h3>

          <label
            className={`flex items-center gap-2.5 select-none ${
              hasDomain ? "cursor-pointer" : "cursor-not-allowed opacity-60"
            }`}
          >
            <input
              type="checkbox"
              checked={autoscaleEnabled && hasDomain}
              disabled={!hasDomain}
              onChange={(e) => setAutoscaleEnabled(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-text-secondary">
              Automatically scale replicas by average CPU/memory load
            </span>
          </label>

          {!hasDomain && (
            <p className="text-[11px] text-text-muted">
              Add a domain first — replicas (and autoscaling) require the load
              balancer.
            </p>
          )}

          {autoscaleEnabled && hasDomain && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Input
                  label="Min replicas"
                  type="number"
                  min={1}
                  max={10}
                  value={autoscaleMin}
                  onChange={(e) => setAutoscaleMin(e.target.value)}
                />
                <Input
                  label="Max replicas"
                  type="number"
                  min={1}
                  max={10}
                  value={autoscaleMax}
                  onChange={(e) => setAutoscaleMax(e.target.value)}
                />
                <Input
                  label="CPU target %"
                  type="number"
                  min={10}
                  max={100}
                  value={autoscaleCpuTarget}
                  onChange={(e) => setAutoscaleCpuTarget(e.target.value)}
                  placeholder="off"
                />
                <Input
                  label="Memory target %"
                  type="number"
                  min={10}
                  max={100}
                  value={autoscaleMemTarget}
                  onChange={(e) => setAutoscaleMemTarget(e.target.value)}
                  placeholder="off"
                />
              </div>
              <p className="text-[11px] text-text-muted">
                Adds a replica when sustained load exceeds a target, removes one
                when it stays low — within the min/max bounds. CPU target is a
                percentage of the CPU limit (or of one core if unset). Leave a
                target empty to ignore that metric. Local servers only.
              </p>
            </>
          )}
        </section>

        {/* Health Check */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Health Check
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Type"
              value={hcType}
              onChange={(e) => setHcType(e.target.value)}
              options={[
                { value: "http", label: "HTTP — GET request" },
                { value: "tcp", label: "TCP — port check" },
                { value: "none", label: "None — skip" },
              ]}
            />
            {hcType === "http" && (
              <Input
                label="Path"
                value={hcPath}
                onChange={(e) => setHcPath(e.target.value)}
                placeholder="/health"
              />
            )}
          </div>

          {hcType !== "none" && (
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Timeout (s)"
                type="number"
                min={1}
                max={60}
                value={hcTimeout}
                onChange={(e) => setHcTimeout(e.target.value)}
              />
              <Input
                label="Interval (s)"
                type="number"
                min={1}
                max={60}
                value={hcInterval}
                onChange={(e) => setHcInterval(e.target.value)}
              />
              <Input
                label="Retries"
                type="number"
                min={1}
                max={20}
                value={hcRetries}
                onChange={(e) => setHcRetries(e.target.value)}
              />
            </div>
          )}

          {hcType !== "none" && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hcRequired}
                onChange={(e) => setHcRequired(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-text-secondary">
                Fail deploy if health check does not pass
              </span>
            </label>
          )}

          <p className="text-[11px] text-text-muted">
            {hcType === "http" &&
              "Sends a GET request after deploy. Any response below 500 is considered healthy."}
            {hcType === "tcp" &&
              "Opens a TCP connection to the configured port. Useful for databases or non-HTTP services."}
            {hcType === "none" &&
              "The container will be marked running immediately after starting."}
          </p>
        </section>

        {/* Security Scanning */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3" />
            Security Scanning
          </h3>

          <Select
            label="Image vulnerability scan"
            value={scanMode}
            onChange={(e) =>
              setScanMode(e.target.value as "default" | "on" | "off")
            }
            options={[
              { value: "default", label: "Use server default" },
              { value: "on", label: "Always scan" },
              { value: "off", label: "Never scan" },
            ]}
          />
          <p className="text-[11px] text-text-muted">
            Scans the built image with Trivy after each build (advisory — results
            appear on the deployment, the deploy is never blocked). Local servers
            only.
          </p>
        </section>

        {/* Preview Deployments */}
        <section className="space-y-3 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <GitBranch className="w-3 h-3" />
            Preview Deployments
          </h3>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={previewEnabled}
              onChange={(e) => setPreviewEnabled(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-text-secondary">
              Auto-deploy pull requests as preview environments
            </span>
          </label>

          {previewEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Input
                  label="Base domain (optional)"
                  value={previewDomain}
                  onChange={(e) => setPreviewDomain(e.target.value)}
                  placeholder="example.com"
                />
                <p className="text-[11px] text-text-muted">
                  PRs will get{" "}
                  <code className="font-mono">pr-42.example.com</code>. Requires
                  a <code className="font-mono">*.example.com</code> DNS record.
                </p>
              </div>
            </div>
          )}
        </section>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {saveFailed && (
          <p className="text-xs text-danger">
            Save failed: {saveError?.message ?? "Unknown error"}
          </p>
        )}
      </div>
    </Card>
  );
});
