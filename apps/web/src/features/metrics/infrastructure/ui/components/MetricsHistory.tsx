import { memo } from "react";

import { MetricCard } from "@metrics/infrastructure/ui/components";

import { useMetricsHistory } from "@metrics/infrastructure/ui/hooks/useMetricsHistory";

import { formatBytes } from "@lib/utils";

import type { MetricsHistoryPropsI } from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

export const MetricsHistory: React.FC<MetricsHistoryPropsI> = memo(
  function MetricsHistory({ serviceId }) {
    const { history, isLoading, live, allSamples, latest } =
      useMetricsHistory(serviceId);

    if (isLoading) {
      return <p className="text-sm text-text-muted py-4">Loading metrics…</p>;
    }

    if (!history?.length && !live) {
      return (
        <p className="text-sm text-text-muted py-4">
          No metrics yet. Data is collected every 30 seconds while the service
          is running.
        </p>
      );
    }

    const cpuData = allSamples.map((s) => s.cpu);
    const memData = allSamples.map((s) => s.memPercent);
    const netRxData = allSamples.map((s) => s.netRx);
    const netTxData = allSamples.map((s) => s.netTx);

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="CPU"
            value={`${latest?.cpu.toFixed(1) ?? "–"}%`}
            barPercent={latest?.cpu ?? 0}
            sparkData={cpuData}
            color="#378ADD"
          />
          <MetricCard
            label="Memory"
            value={`${latest?.memPercent.toFixed(1) ?? "–"}%`}
            subValue={
              latest
                ? `${formatBytes(latest.memUsed)} / ${formatBytes(latest.memTotal)}`
                : undefined
            }
            barPercent={latest?.memPercent ?? 0}
            sparkData={memData}
            color="#1D9E75"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="Network RX"
            value={latest ? formatBytes(latest.netRx) : "–"}
            barPercent={0}
            sparkData={netRxData}
            color="#7F77DD"
            unit="bytes"
          />
          <MetricCard
            label="Network TX"
            value={latest ? formatBytes(latest.netTx) : "–"}
            barPercent={0}
            sparkData={netTxData}
            color="#D85A30"
            unit="bytes"
          />
        </div>

        {allSamples.length > 0 && (
          <p className="text-xs text-text-muted text-right">
            {allSamples.length} samples · last 30 min · updates every 30s
          </p>
        )}
      </div>
    );
  },
);
