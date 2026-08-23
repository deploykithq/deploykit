import { useEffect, useMemo, useState } from "react";

import { trpc } from "@lib/trpc";

import { SEARCH_DEBOUNCE_MS, SEARCH_REFETCH_MS } from "../constants/styles";

import type {
  LogLevelT,
  LogServiceTypeT,
} from "../interfaces/LogSearchPanelI";

/** Convierte el valor de un <input type="datetime-local"> (local, sin tz) en ISO. */
const toIso = (local: string): string | undefined =>
  local ? new Date(local).toISOString() : undefined;

export const useLogSearch = (
  serviceId: string,
  serviceType: LogServiceTypeT,
) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [level, setLevel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  // Se retrasa la búsqueda por texto libre para no lanzar una petición por tecla.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Cualquier cambio de filtro vuelve a la primera página.
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, level, from, to]);

  const input = useMemo(
    () => ({
      serviceId,
      serviceType,
      page,
      query: debouncedQuery || undefined,
      level: (level || undefined) as LogLevelT | undefined,
      from: toIso(from),
      to: toIso(to),
    }),
    [serviceId, serviceType, page, debouncedQuery, level, from, to],
  );

  const { data, isLoading, isError, error } = trpc.logs.search.useQuery(input, {
    refetchInterval: SEARCH_REFETCH_MS,
  });

  return {
    data,
    isLoading,
    isError,
    error,
    query,
    setQuery,
    level,
    setLevel,
    from,
    setFrom,
    to,
    setTo,
    page,
    setPage,
  };
};
