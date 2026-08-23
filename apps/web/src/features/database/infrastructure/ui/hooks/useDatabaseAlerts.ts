import { trpc } from "@lib/trpc";

import { ALERTS_REFETCH_MS } from "@database/infrastructure/ui/constants/database.constants";

export const useDatabaseAlerts = (databaseId: string) => {
  const { data: openAlerts } = trpc.metrics.recentEvents.useQuery(
    { serviceId: databaseId, onlyOpen: true, limit: 10 },
    { refetchInterval: ALERTS_REFETCH_MS },
  );

  return { openAlerts };
};
