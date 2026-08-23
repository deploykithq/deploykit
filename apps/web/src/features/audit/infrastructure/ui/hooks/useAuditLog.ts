import { useCallback, useDeferredValue, useState } from "react";

import { trpc } from "@lib/trpc";

import type { FiltersI } from "@audit/infrastructure/ui/interfaces/audit.interfaces";

export const useAuditLog = () => {
  const [page, setPage] = useState<number>(1);
  const [filters, setFilters] = useState<FiltersI>({
    search: "",
    resourceType: "",
    action: "",
  });

  // El texto de búsqueda se difiere: la UI responde a cada tecla al instante
  // pero la petición solo sale cuando React termina de renderizar.
  const deferredSearch = useDeferredValue(filters.search);

  const handleFilters = useCallback((f: FiltersI) => {
    setFilters(f);
    setPage(1);
  }, []);

  const { data, isLoading } = trpc.audit.list.useQuery(
    {
      page,
      search: deferredSearch || undefined,
      resourceType: filters.resourceType || undefined,
      action: filters.action || undefined,
    },
    { placeholderData: (prev) => prev },
  );

  return { data, isLoading, page, setPage, filters, handleFilters };
};
