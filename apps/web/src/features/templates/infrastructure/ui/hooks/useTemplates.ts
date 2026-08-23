import { useMemo, useState } from "react";
import type { Template } from "@deploykit/shared";

import { trpc } from "@lib/trpc";

export const useTemplates = () => {
  const { data: templates, isLoading } = trpc.template.list.useQuery();
  const [selected, setSelected] = useState<Template | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const t of templates ?? []) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return map;
  }, [templates]);

  return { isLoading, grouped, selected, setSelected };
};
