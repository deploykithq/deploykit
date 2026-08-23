import { trpc } from "@lib/trpc";

export const useServerSelector = () => {
  const { data: servers } = trpc.server.list.useQuery();

  // Solo se ofrecen servidores conectados.
  const available = servers?.filter((s) => s.status === "connected") || [];

  return { available };
};
