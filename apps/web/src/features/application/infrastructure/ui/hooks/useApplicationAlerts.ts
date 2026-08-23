import { trpc } from "@lib/trpc";

import { ALERTS_REFETCH_MS } from "@application/infrastructure/ui/constants/application.constants";

export const useApplicationAlerts = (applicationId: string) => {
  const { data: openAlerts } = trpc.metrics.recentEvents.useQuery(
    { serviceId: applicationId, onlyOpen: true, limit: 10 },
    { refetchInterval: ALERTS_REFETCH_MS },
  );

  return { openAlerts };
};
