import { trpc } from "@lib/trpc";

export const useAuditStats = () => {
  const { data: stats } = trpc.audit.stats.useQuery();

  return { stats };
};
