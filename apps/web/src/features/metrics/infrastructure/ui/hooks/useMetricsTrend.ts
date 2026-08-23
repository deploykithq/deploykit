import { useState } from "react";

import { trpc } from "@lib/trpc";

import { METRICS_REFETCH_MS } from "@metrics/infrastructure/ui/constants/metrics.constants";

import type { TrendRangeT } from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

export const useMetricsTrend = (serviceId: string) => {
  const [range, setRange] = useState<TrendRangeT>("24h");

  const { data, isLoading } = trpc.metrics.timeseries.useQuery(
    { serviceId, range },
    { refetchInterval: METRICS_REFETCH_MS },
  );

  return {
    range,
    setRange,
    isLoading,
    points: data?.points ?? [],
    resolution: data?.resolution,
  };
};
