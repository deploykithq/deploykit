import { memo } from "react";
import { Check, Eye, EyeOff, Globe, Plus, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { Input } from "@shared/components/input";
import { Select } from "@shared/components/select";
import { LogSearchPanel } from "@shared/components/log-search-panel";

import { LogViewer } from "@application/infrastructure/ui/components/LogViewer";
import { MonitoringPanel } from "@metrics/infrastructure/ui/components/MonitoringPanel";

import { ContainerSelector } from "@compose/infrastructure/ui/components/ContainerSelector";

import {
  useComposeFileTab,
  useComposeEnvTab,
  useComposeDomainsTab,
  useComposeLogs,
} from "@compose/infrastructure/ui/hooks/useComposeTabs";

import { cn } from "@lib/utils";

import type { ComposeContainerI } from "@compose/infrastructure/ui/interfaces/compose.interfaces";

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

interface GeneralTabPropsI {
  stack: any;
  containers: ComposeContainerI[];
}

export const GeneralTab: React.FC<GeneralTabPropsI> = memo(function GeneralTab({
  stack,
  containers,
}) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Source", stack.sourceType === "template" ? "Template" : "Custom Compose"],
    ...(stack.templateId
      ? ([
          [
            "Template",
            `${stack.templateId}${stack.templateVersion ? ` · ${stack.templateVersion}` : ""}`,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ["Services", stack.services?.join(", ") || "—"],
    ["Server", stack.server?.name ?? "Local"],
    ["Created", new Date(stack.createdAt).toLocaleString()],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-medium mb-3">Stack</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 min-w-0">
              <dt className="text-text-secondary shrink-0">{label}</dt>
              <dd className="text-right truncate">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <h3 className="text-sm font-medium mb-3">
          Containers
          <span className="ml-2 text-xs text-text-muted font-normal">
            {containers.length}
          </span>
        </h3>
        {containers.length === 0 ? (
          <p className="text-xs text-text-muted">
            Nothing running yet. Deploy the stack to start its containers.
          </p>
        ) : (
          <div className="space-y-1.5">
            {containers.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-sm bg-surface-2 rounded-lg px-3 py-2"
              >
                <span className="font-mono text-xs truncate">{c.name}</span>
                <span
                  className={cn(
                    "text-xs shrink-0",
                    c.state === "running" ? "text-success" : "text-text-muted",
                  )}
                >
                  {c.state}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {stack.domains?.length > 0 && (
        <Card>
          <h3 className="text-sm font-medium mb-3">Routes</h3>
          <div className="space-y-1.5">
            {stack.domains.map((d: any) => (
              <a
                key={d.id}
                href={`${d.https ? "https" : "http"}://${d.domain}${d.path ?? ""}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-accent hover:underline"
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {d.https ? "https" : "http"}://{d.domain}
                  {d.path ?? ""}
                </span>
                <span className="text-xs text-text-muted shrink-0">
                  → {d.serviceName}:{d.port}
                </span>
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Compose file
// ---------------------------------------------------------------------------

interface ComposeFileTabPropsI {
  stack: any;
  composeId: string;
  canOperate: boolean;
}

export const ComposeFileTab: React.FC<ComposeFileTabPropsI> = memo(
  function ComposeFileTab({ stack, composeId, canOperate }) {
    const { text, setText, saved, saving, error, dirty, handleSave } =
      useComposeFileTab(stack, composeId);

    if (stack.composeFile === null) {
      return (
        <Card>
          <p className="text-sm text-text-muted">
            The Compose file can contain credentials, so it is only shown to
            operators and admins of this project.
          </p>
        </Card>
      );
    }

    return (
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-medium">docker-compose.yml</h3>
            <p className="text-xs text-text-muted">
              DeployKit adds routing labels and the shared network at deploy
              time — no need to write them here.
            </p>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!canOperate}
            rows={22}
            spellCheck={false}
            className="w-full px-4 py-3 rounded-lg bg-surface-2 border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-accent resize-y"
          />

          {error && <p className="text-xs text-danger">{error}</p>}

          {canOperate && (
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving || !dirty}>
                {saving ? "Saving..." : "Save Compose file"}
              </Button>
              {saved && (
                <span className="text-xs text-success flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Saved
                </span>
              )}
              <span className="text-xs text-text-muted">
                Redeploy to apply.
              </span>
            </div>
          )}
        </div>
      </Card>
    );
  },
);

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const maskEnvValues = (text: string): string =>
  text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return line;
      return trimmed.slice(0, eqIdx) + "=" + "•".repeat(8);
    })
    .join("\n");

interface EnvVarsTabPropsI {
  stack: any;
  composeId: string;
  canOperate: boolean;
}

export const EnvVarsTab: React.FC<EnvVarsTabPropsI> = memo(function EnvVarsTab({
  stack,
  composeId,
  canOperate,
}) {
  const {
    envText,
    setEnvText,
    saved,
    showValues,
    setShowValues,
    saving,
    error,
    handleSave,
  } = useComposeEnvTab(stack, composeId);

  if (!stack.canViewEnv) {
    return (
      <Card>
        <p className="text-sm text-text-muted">
          Environment variables are only shown to operators and admins of this
          project.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-medium">Environment Variables</h3>
          <div className="flex items-center gap-3">
            <p className="text-xs text-text-muted">
              KEY=VALUE format, one per line
            </p>
            <button
              type="button"
              onClick={() => setShowValues(!showValues)}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors px-2 py-1 rounded-md hover:bg-surface-2"
            >
              {showValues ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {showValues ? "Hide" : "Reveal"}
            </button>
          </div>
        </div>

        <textarea
          value={showValues ? envText : maskEnvValues(envText)}
          onChange={(e) => setEnvText(e.target.value)}
          onFocus={() => setShowValues(true)}
          readOnly={!canOperate}
          rows={12}
          spellCheck={false}
          className="w-full px-4 py-3 rounded-lg bg-surface-2 border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-accent resize-y"
        />

        {error && <p className="text-xs text-danger">{error}</p>}

        {canOperate && (
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Environment"}
            </Button>
            {saved && (
              <span className="text-xs text-success flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </div>
        )}

        <p className="text-xs text-text-muted">
          Written to the stack's <code>.env</code>, which Compose reads to fill
          the <code>{"${VAR}"}</code> placeholders in the Compose file.
          Encrypted at rest; a redeploy applies changes.
        </p>
      </div>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

interface DomainsTabPropsI {
  stack: any;
  composeId: string;
  canOperate: boolean;
}

export const DomainsTab: React.FC<DomainsTabPropsI> = memo(function DomainsTab({
  stack,
  composeId,
  canOperate,
}) {
  const {
    services,
    serviceName,
    setServiceName,
    domain,
    setDomain,
    port,
    setPort,
    https,
    setHttps,
    adding,
    error,
    handleAdd,
    handleRemove,
  } = useComposeDomainsTab(stack, composeId);

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-medium mb-3">Domains</h3>
        {stack.domains?.length === 0 ? (
          <p className="text-xs text-text-muted">
            No domains yet. Without one, a service is only reachable from inside
            the stack.
          </p>
        ) : (
          <div className="space-y-1.5">
            {stack.domains.map((d: any) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 bg-surface-2 rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <a
                    href={`${d.https ? "https" : "http"}://${d.domain}${d.path ?? ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-accent hover:underline truncate block"
                  >
                    {d.https ? "https" : "http"}://{d.domain}
                    {d.path ?? ""}
                  </a>
                  <p className="text-xs text-text-muted font-mono">
                    → {d.serviceName}:{d.port}
                  </p>
                </div>
                {canOperate && (
                  <button
                    type="button"
                    onClick={() => handleRemove(d.id)}
                    className="text-text-muted hover:text-danger shrink-0"
                    title="Remove domain"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canOperate && (
        <Card>
          <h3 className="text-sm font-medium mb-3">Add a domain</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Service"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              options={services.map((s) => ({ value: s, label: s }))}
            />
            <Input
              label="Container port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="80"
              inputMode="numeric"
            />
            <div className="sm:col-span-2">
              <Input
                label="Domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="app.example.com"
                autoComplete="off"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 mt-3 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={https}
              onChange={(e) => setHttps(e.target.checked)}
            />
            Request an HTTPS certificate (needs the domain to resolve here)
          </label>

          {error && <p className="text-xs text-danger mt-2">{error}</p>}

          <div className="flex justify-end mt-3">
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={adding || !domain.trim() || !serviceName}
            >
              <Plus className="w-3.5 h-3.5" />
              {adding ? "Adding…" : "Add domain"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

interface LogsTabPropsI {
  composeId: string;
  containers: ComposeContainerI[];
  selectedContainerId: string | null;
  onSelectContainer: (id: string) => void;
}

export const LogsTab: React.FC<LogsTabPropsI> = memo(function LogsTab({
  composeId,
  containers,
  selectedContainerId,
  onSelectContainer,
}) {
  const { mode, setMode, allLogs } = useComposeLogs(
    composeId,
    selectedContainerId,
  );

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-medium">Container Logs</h3>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {(["live", "history"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1.5 capitalize transition-colors",
                mode === m
                  ? "bg-surface-2 text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === "live" ? (
        <>
          <div className="mb-3">
            <ContainerSelector
              containers={containers}
              value={selectedContainerId}
              onChange={onSelectContainer}
            />
          </div>
          <LogViewer
            lines={
              allLogs.length > 0
                ? allLogs
                : ["No logs available. Deploy the stack first."]
            }
          />
        </>
      ) : (
        // History is stack-wide: every container persists under the stack's id.
        <LogSearchPanel serviceId={composeId} serviceType="compose" />
      )}
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export const MonitoringTab: React.FC<{ composeId: string }> = memo(
  function MonitoringTab({ composeId }) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-text-muted">
          CPU, memory and network are summed across every container in the
          stack.
        </p>
        <MonitoringPanel serviceId={composeId} />
      </div>
    );
  },
);
