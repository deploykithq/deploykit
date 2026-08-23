import { trpc } from "@lib/trpc";

import { METRICS_REFETCH_MS } from "@metrics/infrastructure/ui/constants/metrics.constants";

export const useAlertStats = () => {
  const { data: stats } = trpc.metrics.alertStats.useQuery(undefined, {
    refetchInterval: METRICS_REFETCH_MS,
  });

  return { stats };
};
