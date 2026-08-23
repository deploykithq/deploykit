import { useMemo, useState } from "react";

import { trpc } from "@lib/trpc";

export const useSecurityTab = (applicationId: string) => {
  const { data: deployments } = trpc.application.deployments.useQuery({
    id: applicationId,
  });

  // Solo los deploys que llegaron a ejecutar un escaneo tienen estado.
  const scanned = useMemo(
    () => (deployments ?? []).filter((d) => !!d.scanStatus),
    [deployments],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const selected = scanned.find((d) => d.id === selectedId) ?? scanned[0] ?? null;

  return {
    deployments,
    scanned,
    selected,
    selectedId,
    setSelectedId,
    active,
    setActive,
    query,
    setQuery,
  };
};
