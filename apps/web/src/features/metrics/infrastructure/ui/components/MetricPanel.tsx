import { memo } from "react";

import { Card } from "@shared/components/card";

import { MetricChart } from "@metrics/infrastructure/ui/components/MetricChart";

import { CHART_HEIGHT } from "@metrics/infrastructure/ui/constants/metrics.constants";

import type { MetricPanelPropsI } from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

export const MetricPanel: React.FC<MetricPanelPropsI> = memo(
  function MetricPanel({
    title,
    value,
    valueLabel = "Used",
    limit,
    percent,
    isLoading,
    data,
    series,
    formatValue,
    formatAxis,
    range,
    domain,
  }) {
    const clamped = Math.min(Math.max(percent ?? 0, 0), 100);
    const barColor =
      clamped >= 90 ? "bg-danger" : clamped >= 75 ? "bg-warning" : "bg-accent";

    return (
      <Card className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            {valueLabel}:{" "}
            <span className="font-medium tabular-nums text-text-primary">
              {value}
            </span>
            {limit && (
              <>
                {" / Limit: "}
                <span className="tabular-nums">{limit}</span>
              </>
            )}
          </p>
        </div>

        {/* The bar row is always reserved, so every card in a row keeps the
            same internal rhythm and their plot baselines line up. */}
        {percent === undefined ? (
          <div className="h-1.5" aria-hidden />
        ) : (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${clamped}%` }}
            />
          </div>
        )}

        {isLoading || data.length < 2 ? (
          <p
            className="flex items-center justify-center px-4 text-center text-sm text-text-muted"
            style={{ height: CHART_HEIGHT }}
          >
            {isLoading
              ? "Loading history…"
              : "Not enough history for this range yet."}
          </p>
        ) : (
          <MetricChart
            data={data}
            series={series}
            formatValue={formatValue}
            formatAxis={formatAxis}
            range={range}
            domain={domain}
          />
        )}

        {/* Reserved like the bar row above. A single series needs no legend —
            the title already names it — but the space still counts. */}
        {series.length > 1 ? (
          <div className="flex h-4 items-center gap-4 text-xs text-text-secondary">
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: s.color, opacity: s.fillOpacity ?? 1 }}
                />
                {s.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="h-4" aria-hidden />
        )}
      </Card>
    );
  },
);
