import { memo } from "react";

import type { ChartTooltipPropsI } from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

/**
 * Crosshair tooltip. The colour swatch carries the series identity so the
 * labels and values can stay in plain text tokens.
 */
export const ChartTooltip: React.FC<ChartTooltipPropsI> = memo(
  function ChartTooltip({ series, formatValue, active, label, payload }) {
    if (!active || !payload?.length) return null;

    return (
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-lg">
        <p className="mb-1 text-xs text-text-muted">
          {label !== undefined ? new Date(label).toLocaleString() : ""}
        </p>
        {payload.map((entry) => {
          const s = series.find((x) => x.key === entry.dataKey);
          if (!s || entry.value === undefined || entry.value === null) {
            return null;
          }

          return (
            <div
              key={s.key}
              className="flex items-center gap-2 text-xs whitespace-nowrap"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: s.color, opacity: s.fillOpacity ?? 1 }}
              />
              <span className="text-text-secondary">{s.label}</span>
              <span className="ml-auto pl-3 font-medium tabular-nums text-text-primary">
                {formatValue(entry.value)}
              </span>
            </div>
          );
        })}
      </div>
    );
  },
);
