import { memo } from "react";
import { ChevronLeft, ChevronRight, Shield } from "lucide-react";

import { Card } from "@shared/components/card";

import {
  EntryRow,
  FilterBar,
  StatsBar,
} from "@audit/infrastructure/ui/components";

import { useAuditLog } from "@audit/infrastructure/ui/hooks/useAuditLog";

export const AuditLogPage: React.FC = memo(function AuditLogPage() {
  const { data, isLoading, page, setPage, filters, handleFilters } =
    useAuditLog();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5 text-text-muted" />
            Audit Log
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Every action taken in this DeployKit instance
          </p>
        </div>
      </div>

      <StatsBar />

      <FilterBar filters={filters} onChange={handleFilters} />

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs text-text-muted uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">When</th>
                <th className="px-4 py-3 text-left font-medium">User</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3 text-left font-medium">Resource</th>
                <th className="px-4 py-3 text-left font-medium">IP</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-text-muted"
                  >
                    Loading…
                  </td>
                </tr>
              ) : !data?.entries.length ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-text-muted"
                  >
                    No audit events found
                  </td>
                </tr>
              ) : (
                data.entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-text-muted">
              {data.total} events · page {data.page} of {data.totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                className="p-1.5 rounded hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                onClick={() => setPage((p) => p + 1)}
                disabled={page === data.totalPages}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
});
