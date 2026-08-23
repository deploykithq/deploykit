import { memo } from "react";
import { Search } from "lucide-react";

import {
  LOG_LEVEL_COLORS,
  LOG_LEVEL_FALLBACK,
  LOG_LEVELS,
} from "../constants/styles";

import { useLogSearch } from "../hooks/useLogSearch";

import type {
  LogLevelT,
  LogSearchPanelPropsI,
} from "../interfaces/LogSearchPanelI";

const levelClass = (level: string | null): string =>
  LOG_LEVEL_COLORS[level as LogLevelT] ?? LOG_LEVEL_FALLBACK;

export const LogSearchPanel: React.FC<LogSearchPanelPropsI> = memo(
  function LogSearchPanel({ serviceId, serviceType }) {
    const {
      data,
      isLoading,
      isError,
      error,
      query,
      setQuery,
      level,
      setLevel,
      from,
      setFrom,
      to,
      setTo,
      page,
      setPage,
    } = useLogSearch(serviceId, serviceType);

    return (
      <div className="space-y-3">
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border bg-surface-1 placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Search log messages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <select
            className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">All levels</option>
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </option>
            ))}
          </select>

          <input
            type="datetime-local"
            className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            title="From"
          />
          <input
            type="datetime-local"
            className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            title="To"
          />
        </div>

        {/* Result count */}
        <div className="text-xs text-text-muted">
          {isLoading
            ? "Loading…"
            : isError
              ? null
              : `${data?.total ?? 0} log line${data?.total === 1 ? "" : "s"} found`}
        </div>

        {/* Results */}
        {isError ? (
          <div className="text-sm text-danger p-3">
            {error?.message ?? "Failed to load logs."}
          </div>
        ) : (
          <div className="bg-surface-0 border border-border rounded-lg max-h-96 overflow-y-auto font-mono text-xs leading-5 divide-y divide-border/50">
            {!data || data.entries.length === 0 ? (
              <div className="p-4 text-text-muted">
                No logs match these filters.
              </div>
            ) : (
              data.entries.map((row) => (
                <div
                  key={row.id}
                  className="flex gap-3 px-3 py-1.5 hover:bg-surface-1"
                >
                  <span className="text-text-muted shrink-0 tabular-nums">
                    {new Date(row.timestamp).toLocaleString()}
                  </span>
                  {row.level && (
                    <span
                      className={`shrink-0 uppercase ${levelClass(row.level)}`}
                    >
                      {row.level}
                    </span>
                  )}
                  <span className="text-text-secondary whitespace-pre-wrap break-all">
                    {row.message}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 text-xs">
            <button
              className="px-2 py-1 rounded border border-border disabled:opacity-40 hover:bg-surface-1"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span className="text-text-muted">
              Page {data.page} of {data.totalPages}
            </span>
            <button
              className="px-2 py-1 rounded border border-border disabled:opacity-40 hover:bg-surface-1"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  },
);
