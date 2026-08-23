import { useState } from "react";

import { trpc } from "@lib/trpc";

import type { PruneResultI } from "@server/infrastructure/ui/interfaces/server.interfaces";

export const useImageCleanup = () => {
  const [keep, setKeep] = useState<number>(3);
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [results, setResults] = useState<PruneResultI[] | null>(null);

  const pruneMutation = trpc.server.pruneImagesAll.useMutation({
    onSuccess: (data) => setResults(data),
  });

  const totalRemoved = results?.reduce((s, r) => s + r.imagesRemoved, 0) ?? 0;
  const totalFreed = results?.reduce((s, r) => s + r.bytesFreed, 0) ?? 0;

  const runPrune = () => {
    setResults(null);
    pruneMutation.mutate({ keep, dryRun });
  };

  return {
    keep,
    setKeep,
    dryRun,
    setDryRun,
    results,
    setResults,
    totalRemoved,
    totalFreed,
    pruning: pruneMutation.isPending,
    error: pruneMutation.error,
    runPrune,
  };
};
