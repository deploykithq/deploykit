import { memo } from "react";

import { MonitoringPanel } from "@metrics/infrastructure/ui/components/MonitoringPanel";

import { useApplicationAlerts } from "@application/infrastructure/ui/hooks/useApplicationAlerts";

interface MonitoringTabPropsI {
  applicationId: string;
}

export const MonitoringTab: React.FC<MonitoringTabPropsI> = memo(
  function MonitoringTab({ applicationId }) {
    const { openAlerts } = useApplicationAlerts(applicationId);

    return (
      <div className="space-y-4">
        {!!openAlerts?.length && (
          <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-900/10 p-3">
            <span className="text-sm font-medium text-yellow-600">
              {openAlerts.length} open alert{openAlerts.length !== 1 ? "s" : ""}
            </span>
            <span className="flex-1 truncate text-xs text-text-secondary">
              {openAlerts[0]?.message}
              {openAlerts.length > 1 && ` (+${openAlerts.length - 1} more)`}
            </span>
          </div>
        )}

        <MonitoringPanel serviceId={applicationId} />
      </div>
    );
  },
);
