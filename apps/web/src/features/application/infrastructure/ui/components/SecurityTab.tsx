import { memo, useMemo, useState } from "react";
import { Search, ShieldCheck, ExternalLink } from "lucide-react";

import { Card } from "@shared/components/card";
import { VulnerabilityBadge } from "@application/infrastructure/ui/components/VulnerabilityBadge";

import { useSecurityTab } from "@application/infrastructure/ui/hooks/useSecurityTab";

import { timeAgo } from "@lib/utils";

interface SecurityTabPropsI {
  applicationId: string;
}

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL: "text-danger",
  HIGH: "text-warning",
  MEDIUM: "text-info",
  LOW: "text-text-muted",
  UNKNOWN: "text-text-muted",
};
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

export const SecurityTab: React.FC<SecurityTabPropsI> = memo(
  function SecurityTab({ applicationId }) {
    const {
      deployments,
      scanned,
      selected,
      setSelectedId,
      active,
      setActive,
      query,
      setQuery,
    } = useSecurityTab(applicationId);

    const summary = selected?.scanResults?.summary;
    const vulns = selected?.scanResults?.top ?? [];

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      return vulns.filter((v) => {
        if (active.size > 0 && !active.has(v.severity)) return false;
        if (!q) return true;
        return (
          v.id.toLowerCase().includes(q) ||
          v.pkg.toLowerCase().includes(q) ||
          v.title.toLowerCase().includes(q)
        );
      });
    }, [vulns, active, query]);

    const toggleSeverity = (sev: string) =>
      setActive((prev) => {
        const next = new Set(prev);
        next.has(sev) ? next.delete(sev) : next.add(sev);
        return next;
      });

    if (!deployments) {
      return <div className="text-sm text-text-muted p-6">Loading…</div>;
    }

    if (scanned.length === 0) {
      return (
        <Card>
          <div className="flex flex-col items-center text-center gap-2 py-8">
            <ShieldCheck className="w-8 h-8 text-text-muted" />
            <p className="text-sm font-medium">No scans yet</p>
            <p className="text-xs text-text-muted max-w-sm">
              Vulnerability scans run on each deploy when scanning is enabled
              (General tab → Security Scanning). Deploy this app to see a report.
            </p>
          </div>
        </Card>
      );
    }

    const cells = summary
      ? [
          { label: "Critical", n: summary.critical, cls: "text-danger" },
          { label: "High", n: summary.high, cls: "text-warning" },
          { label: "Medium", n: summary.medium, cls: "text-info" },
          { label: "Low", n: summary.low, cls: "text-text-muted" },
          { label: "Unknown", n: summary.unknown, cls: "text-text-muted" },
        ]
      : [];

    return (
      <div className="space-y-4">
        {/* Deployment selector */}
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Security report</h3>
              {selected && (
                <VulnerabilityBadge
                  scanStatus={selected.scanStatus}
                  summary={selected.scanResults?.summary}
                />
              )}
            </div>
            <select
              className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent max-w-full"
              value={selected?.id ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {scanned.map((d) => (
                <option key={d.id} value={d.id}>
                  {(d.commitHash || d.id.slice(0, 8)) +
                    ` · ${timeAgo(d.createdAt)}`}
                </option>
              ))}
            </select>
          </div>

          {selected?.scanFinishedAt && (
            <p className="text-[11px] text-text-muted mt-2">
              Scanned {timeAgo(selected.scanFinishedAt)}
              {selected.commitMessage ? ` · ${selected.commitMessage}` : ""}
            </p>
          )}
        </Card>

        {/* Status states without a summary */}
        {selected?.scanStatus === "skipped" && (
          <Card>
            <p className="text-xs text-text-muted">
              Vulnerability scan was skipped for this deployment (remote server).
            </p>
          </Card>
        )}
        {selected?.scanStatus === "error" && (
          <Card>
            <p className="text-xs text-warning">
              The vulnerability scan failed to complete for this deployment.
            </p>
          </Card>
        )}

        {summary && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {cells.map((c) => (
                <Card key={c.label}>
                  <div className="text-center">
                    <div className={`text-xl font-semibold ${c.cls}`}>
                      {c.n}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-text-muted">
                      {c.label}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {summary.total === 0 ? (
              <Card>
                <p className="text-sm text-success">
                  No known vulnerabilities found in this image. 🎉
                </p>
              </Card>
            ) : (
              <Card>
                {/* Filters */}
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <div className="relative flex-1 min-w-48">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                    <input
                      className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border bg-surface-1 placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder="Search CVE, package or title…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {SEVERITIES.map((sev) => {
                      const on = active.has(sev);
                      return (
                        <button
                          key={sev}
                          onClick={() => toggleSeverity(sev)}
                          className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                            on
                              ? "border-accent bg-accent-muted text-text-primary"
                              : `border-border ${SEVERITY_CLASS[sev]} hover:bg-surface-2`
                          }`}
                        >
                          {sev}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="text-xs text-text-muted mb-2">
                  {filtered.length} of {vulns.length} shown
                  {vulns.length < summary.total &&
                    ` (capped from ${summary.total})`}
                </div>

                {/* Table */}
                <div className="bg-surface-0 border border-border rounded-lg overflow-x-auto max-h-[32rem] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-0">
                      <tr className="text-text-muted border-b border-border">
                        <th className="text-left font-medium px-3 py-2">
                          Severity
                        </th>
                        <th className="text-left font-medium px-3 py-2">
                          Package
                        </th>
                        <th className="text-left font-medium px-3 py-2">
                          Vulnerability
                        </th>
                        <th className="text-left font-medium px-3 py-2">
                          Installed
                        </th>
                        <th className="text-left font-medium px-3 py-2">
                          Fixed
                        </th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {filtered.map((v, i) => (
                        <tr
                          key={`${v.id}-${v.pkg}-${i}`}
                          className="border-b border-border/40 last:border-0 hover:bg-surface-1"
                        >
                          <td
                            className={`px-3 py-2 whitespace-nowrap ${SEVERITY_CLASS[v.severity] ?? "text-text-muted"}`}
                          >
                            {v.severity}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">
                            {v.pkg}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {v.url ? (
                                <a
                                  href={v.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-accent hover:underline flex items-center gap-1"
                                >
                                  {v.id}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className="text-text-secondary">
                                  {v.id}
                                </span>
                              )}
                            </div>
                            {v.title && (
                              <p className="text-[11px] text-text-muted font-sans mt-0.5 max-w-md truncate">
                                {v.title}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-text-muted whitespace-nowrap">
                            {v.installed || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {v.fixed ? (
                              <span className="text-success">{v.fixed}</span>
                            ) : (
                              <span className="text-text-muted">no fix</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-6 text-center text-text-muted font-sans"
                          >
                            No findings match these filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    );
  },
);
