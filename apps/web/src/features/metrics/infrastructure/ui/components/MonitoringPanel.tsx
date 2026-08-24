import { memo } from "react";

import { MetricPanel } from "@metrics/infrastructure/ui/components/MetricPanel";

import { useMonitoringPanel } from "@metrics/infrastructure/ui/hooks/useMonitoringPanel";

import {
  CPU_COLOR,
  DISK_COLOR,
  MEM_COLOR,
  NET_RX_COLOR,
  NET_TX_COLOR,
  TREND_RANGES,
} from "@metrics/infrastructure/ui/constants/metrics.constants";

import {
  formatBytesAxis,
  formatPercent,
  formatPercentAxis,
  formatRate,
  formatRateAxis,
} from "@metrics/infrastructure/ui/utils/chart.utils";

import { formatBytes } from "@lib/utils";

import type { MonitoringPanelPropsI } from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

export const MonitoringPanel: React.FC<MonitoringPanelPropsI> = memo(
  function MonitoringPanel({ serviceId }) {
    const { range, setRange, isLoading, points, current, resolution } =
      useMonitoringPanel(serviceId);

    const shared = { data: points, range, isLoading };

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {TREND_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  r === range
                    ? "bg-accent text-white"
                    : "text-text-muted hover:bg-surface-2"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {resolution && (
            <span className="text-xs text-text-muted">
              {resolution === "1m" ? "1-minute" : "1-hour"} resolution
            </span>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <MetricPanel
            {...shared}
            title="CPU Usage"
            value={formatPercent(current.cpu)}
            percent={current.cpu}
            domain={[0, 100]}
            formatValue={formatPercent}
            formatAxis={formatPercentAxis}
            // Peak first so the envelope sits behind the average line.
            series={[
              {
                key: "cpuMax",
                label: "Peak",
                color: CPU_COLOR,
                fillOpacity: 0.45,
                strokeWidth: 0,
              },
              { key: "cpu", label: "Average", color: CPU_COLOR },
            ]}
          />

          <MetricPanel
            {...shared}
            title="Memory Usage"
            value={formatBytes(current.memUsed)}
            limit={current.memTotal ? formatBytes(current.memTotal) : undefined}
            percent={current.memTotal ? current.memPercent : undefined}
            formatValue={formatBytes}
            formatAxis={formatBytesAxis}
            series={[{ key: "memUsed", label: "Memory", color: MEM_COLOR }]}
          />

          <MetricPanel
            {...shared}
            title="Disk Usage"
            value={formatBytes(current.disk)}
            formatValue={formatBytes}
            formatAxis={formatBytesAxis}
            series={[{ key: "disk", label: "Disk", color: DISK_COLOR }]}
          />

          <MetricPanel
            {...shared}
            title="Network"
            valueLabel="Rate"
            value={`${formatRate(current.rxPerSec)} in · ${formatRate(current.txPerSec)} out`}
            formatValue={formatRate}
            formatAxis={formatRateAxis}
            // Two independent entities on one axis: as filled areas the
            // upper one hides the lower, so they read as plain lines.
            series={[
              { key: "rxPerSec", label: "In", color: NET_RX_COLOR, fill: false },
              { key: "txPerSec", label: "Out", color: NET_TX_COLOR, fill: false },
            ]}
          />
        </div>
      </div>
    );
  },
);
