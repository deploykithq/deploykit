import { useMemo, useState } from "react";

import { trpc } from "@lib/trpc";

import { METRICS_REFETCH_MS } from "@metrics/infrastructure/ui/constants/metrics.constants";

export const useAlerts = () => {
  const [showCreate, setShowCreate] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(true);

  const { data: events, isLoading: eventsLoading } =
    trpc.metrics.recentEvents.useQuery(
      { limit: 100 },
      { refetchInterval: METRICS_REFETCH_MS },
    );

  const { data: rules, isLoading: rulesLoading } =
    trpc.metrics.listRules.useQuery();

  const visibleEvents = useMemo(
    () => (showResolved ? events : events?.filter((e) => !e.resolvedAt)),
    [events, showResolved],
  );

  return {
    showCreate,
    setShowCreate,
    showResolved,
    setShowResolved,
    rulesOpen,
    setRulesOpen,
    visibleEvents,
    eventsLoading,
    rules,
    rulesLoading,
  };
};
