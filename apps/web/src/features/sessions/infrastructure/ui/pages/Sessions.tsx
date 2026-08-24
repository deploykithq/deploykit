import { memo } from "react";
import { ChevronLeft, ChevronRight, MonitorSmartphone } from "lucide-react";

import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";

import {
  FilterBar,
  SessionRow,
  StatsBar,
} from "@sessions/infrastructure/ui/components";

import { useSessions } from "@sessions/infrastructure/ui/hooks/useSessions";
import { useRevokeSession } from "@sessions/infrastructure/ui/hooks/useRevokeSession";

const COLUMNS = [
  "User",
  "Status",
  "IP",
  "Device",
  "Started",
  "Last activity",
  "Expires",
];

export const SessionsPage: React.FC = memo(function SessionsPage() {
  const { data, isLoading, page, setPage, filters, handleFilters } =
    useSessions();
  const { revokeTarget, setRevokeTarget, handleRevokeConfirm, isRevoking } =
    useRevokeSession();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MonitorSmartphone className="w-5 h-5 text-text-muted" />
            Sessions
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Who is signed in to this DeployKit instance
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
                {COLUMNS.map((column) => (
                  <th key={column} className="px-4 py-3 text-left font-medium">
                    {column}
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length + 1}
                    className="px-4 py-12 text-center text-sm text-text-muted"
                  >
                    Loading…
                  </td>
                </tr>
              ) : !data?.entries.length ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length + 1}
                    className="px-4 py-12 text-center text-sm text-text-muted"
                  >
                    No sessions found
                  </td>
                </tr>
              ) : (
                data.entries.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onRevoke={setRevokeTarget}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-text-muted">
              {data.total} sessions · page {data.page} of {data.totalPages}
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

      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevokeConfirm}
        title="Revoke session"
        description={`${revokeTarget?.userEmail} will be signed out of this session immediately, and any open log or terminal stream will be closed.`}
        confirmText="Revoke"
        pendingText="Revoking..."
        isPending={isRevoking}
      />
    </div>
  );
});
