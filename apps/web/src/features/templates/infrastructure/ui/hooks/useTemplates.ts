import { useMemo, useState } from "react";

import { trpc } from "@lib/trpc";

import type { CatalogEntryT } from "@templates/infrastructure/ui/interfaces/templates.interfaces";

/**
 * El catálogo, con buscador y filtro por etiqueta.
 *
 * Filtra en cliente a propósito: el catálogo entero son unos pocos cientos de
 * entradas de texto que ya vienen en una sola petición, así que un ida y vuelta
 * al servidor por pulsación solo añadiría latencia.
 */
export const useTemplates = () => {
  const { data, isLoading, isFetching, refetch } = trpc.template.list.useQuery();

  const [selected, setSelected] = useState<CatalogEntryT | null>(null);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const templates = useMemo<CatalogEntryT[]>(
    () => data?.templates ?? [],
    [data],
  );

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) {
      for (const tag of t.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [templates]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (activeTag && !(t.tags ?? []).includes(activeTag)) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.id.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [templates, query, activeTag]);

  return {
    isLoading,
    templates,
    filtered,
    tags,
    query,
    setQuery,
    activeTag,
    setActiveTag,
    selected,
    setSelected,
    /**
     * Los blueprints no viajan dentro de la imagen, así que el catálogo puede
     * llegar de tres formas: "remote" (recién leído del registro), "stale"
     * (el registro no responde y esto es la última copia buena) y
     * "unavailable" (no responde y no hay copia). Las dos últimas se avisan.
     */
    source: data?.source ?? "remote",
    error: data?.error,
    cachedAt: data?.cachedAt,
    isRefetching: isFetching && !isLoading,
    refetch,
  };
};
