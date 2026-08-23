import { useServiceMetrics } from "@lib/socket";
import { trpc } from "@lib/trpc";

import { METRICS_REFETCH_MS } from "@metrics/infrastructure/ui/constants/metrics.constants";

export const useMetricsHistory = (serviceId: string) => {
  const { data: history, isLoading } = trpc.metrics.history.useQuery(
    { serviceId },
    { refetchInterval: METRICS_REFETCH_MS },
  );

  // Actualización en vivo por Socket.IO (sustituye al polling mientras se mira).
  const live = useServiceMetrics(serviceId);

  // Historial + punto en vivo, evitando duplicar por ts.
  const allSamples =
    live && (!history?.length || history[history.length - 1]?.ts !== live.ts)
      ? [...(history ?? []), { ...live }]
      : (history ?? []);

  // El valor actual sale del dato en vivo si lo hay; si no, del último histórico.
  const latest = live ?? allSamples[allSamples.length - 1];

  return { history, isLoading, live, allSamples, latest };
};
