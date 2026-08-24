import { trpc } from "@lib/trpc";

export const useSessionStats = () => {
  const { data: stats } = trpc.session.stats.useQuery();

  return { stats };
};
