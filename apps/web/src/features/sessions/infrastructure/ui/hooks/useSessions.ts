import { useCallback, useState } from "react";

import { trpc } from "@lib/trpc";

import type { FiltersI } from "@sessions/infrastructure/ui/interfaces/sessions.interfaces";

const INITIAL_FILTERS: FiltersI = { status: "all", userId: "" };

export const useSessions = () => {
  const [page, setPage] = useState<number>(1);
  const [filters, setFilters] = useState<FiltersI>(INITIAL_FILTERS);

  // Cambiar de filtro devuelve a la primera página: la anterior puede no existir
  // ya en el nuevo conjunto de resultados.
  const handleFilters = useCallback((f: FiltersI) => {
    setFilters(f);
    setPage(1);
  }, []);

  const { data, isLoading } = trpc.session.list.useQuery(
    {
      page,
      status: filters.status,
      userId: filters.userId || undefined,
    },
    { placeholderData: (prev) => prev },
  );

  return { data, isLoading, page, setPage, filters, handleFilters };
};
