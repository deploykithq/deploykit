import { useParams } from "@tanstack/react-router";

import { trpc } from "@lib/trpc";

import { STATUS_REFETCH_MS } from "@status/infrastructure/ui/constants/status.constants";

export const useStatusPage = () => {
  const { slug } = useParams({ from: "/status/$slug" });

  const { data, isLoading, error } = trpc.status.getPublic.useQuery(
    { slug },
    { refetchInterval: STATUS_REFETCH_MS, retry: false },
  );

  return { data, isLoading, error };
};
