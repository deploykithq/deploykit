import { memo, useCallback, useDeferredValue, useState } from "react";
import { Shield, ChevronLeft, ChevronRight } from "lucide-react";

import { Card } from "@shared/components";

import {
  StatsBar,
  FilterBar,
  EntryRow,
} from "@audit/infrastructure/ui/components";

import { trpc } from "@lib/trpc";
import type { FiltersI } from "@audit/infrastructure/ui/types/audit.module.types";

export const AuditLogPage: React.FC = memo(function AuditLogPage() {
  const [page, setPage] = useState<number>(1);
  const [filters, setFilters] = useState<FiltersI>({
    search: "",
    resourceType: "",
    action: "",
  });

  // Defer the search string so keystrokes update the UI instantly
  // but only trigger a new API request after React has finished rendering
  const deferredSearch = useDeferredValue(filters.search);

  const handleFilters = useCallback((f: FiltersI) => {
    setFilters(f);
    setPage(1);
  }, []);

  const { data, isLoading } = trpc.audit.list.useQuery(
    {
      page,
      search: deferredSearch || undefined,
      resourceType: filters.resourceType || undefined,
      action: filters.action || undefined,
    },
    { placeholderData: (prev) => prev },
  );

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
