import { memo } from "react";

import { MetricsHistory } from "@metrics/infrastructure/ui/components/MetricsHistory";
import { MetricsTrendChart } from "@metrics/infrastructure/ui/components/MetricsTrendChart";

import { trpc } from "@lib/trpc";

import type { DatabaseI } from "@database/infrastructure/ui/interfaces/database.module.interfaces";

interface MonitoringTabPropsI {
  db: DatabaseI;
  databaseId: string;
}

export const MonitoringTab: React.FC<MonitoringTabPropsI> = memo(
  function MonitoringTab({ db, databaseId }) {
    const { data: openAlerts } = trpc.metrics.recentEvents.useQuery(
      { serviceId: databaseId, onlyOpen: true, limit: 10 },
      { refetchInterval: 30_000 },
    );

    return (
      <div className="space-y-4">
        {!!openAlerts?.length && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-900/10 p-3 flex items-center gap-3">
            <span className="text-yellow-600 text-sm font-medium">
              {openAlerts.length} open alert{openAlerts.length !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-text-secondary flex-1 truncate">
              {openAlerts[0]?.message}
              {openAlerts.length > 1 && ` (+${openAlerts.length - 1} more)`}
            </span>
          </div>
        )}

        <MetricsHistory serviceId={databaseId} containerId={db.containerId ?? null} />
        <MetricsTrendChart serviceId={databaseId} />
      </div>
    );
  },
);
