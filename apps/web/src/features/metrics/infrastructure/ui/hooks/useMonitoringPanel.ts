import { useMemo, useState } from "react";

import { useServiceMetrics } from "@lib/socket";
import { trpc } from "@lib/trpc";

import { METRICS_REFETCH_MS } from "@metrics/infrastructure/ui/constants/metrics.constants";

import { toChartPoints } from "@metrics/infrastructure/ui/utils/chart.utils";

import type {
  TimeseriesPointI,
  TrendRangeT,
} from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

/**
 * Owns the range shared by every card in the Monitoring panel.
 *
 * The chart body follows the selected range, but the headline numbers always
 * come from the live socket sample when there is one — a 30-day range must not
 * make the "current" value a month-old average.
 */
export const useMonitoringPanel = (serviceId: string) => {
  const [range, setRange] = useState<TrendRangeT>("24h");

  const { data, isLoading } = trpc.metrics.timeseries.useQuery(
    { serviceId, range },
    { refetchInterval: METRICS_REFETCH_MS },
  );

  const live = useServiceMetrics(serviceId);

  const points = useMemo(
    () => toChartPoints((data?.points ?? []) as TimeseriesPointI[]),
    [data?.points],
  );

  const last = points[points.length - 1];

  const current = {
    cpu: live?.cpu ?? last?.cpu ?? 0,
    memUsed: live?.memUsed ?? last?.memUsed ?? 0,
    memTotal: live?.memTotal ?? 0,
    memPercent: live?.memPercent ?? last?.memPercent ?? 0,
    disk: live?.diskUsed ?? last?.disk ?? 0,
    rxPerSec: last?.rxPerSec ?? 0,
    txPerSec: last?.txPerSec ?? 0,
  };

  return {
    range,
    setRange,
    isLoading,
    points,
    current,
    resolution: data?.resolution,
  };
};
