import { memo } from "react";

import type { UptimePropsI } from "@status/infrastructure/ui/interfaces/status.interfaces";

export const Uptime: React.FC<UptimePropsI> = memo(function Uptime({
  label,
  value,
}) {
  return (
    <div className="text-center">
      <p className="text-sm font-semibold tabular-nums">
        {value === null ? "—" : `${value.toFixed(1)}%`}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </p>
    </div>
  );
});
