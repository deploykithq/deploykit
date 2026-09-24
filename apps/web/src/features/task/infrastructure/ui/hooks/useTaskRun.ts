import { useMemo } from "react";

import { useTaskRunLogs } from "@lib/socket";
import { trpc } from "@lib/trpc";

import { RUNS_REFETCH_MS } from "@task/infrastructure/ui/constants/task.constants";

/**
 * A run's output from both sides: the live stream while it runs, and the
 * stored tail for one that already finished (or that started before this
 * client subscribed).
 */
export const useTaskRun = (runId: string | null) => {
  const live = useTaskRunLogs(runId);
  const stored = trpc.task.runOutput.useQuery(
    { id: runId ?? "" },
    {
      enabled: !!runId,
      refetchInterval: live.status ? false : RUNS_REFETCH_MS,
    },
  );

  const text = useMemo(() => {
    const streamed = live.lines.join("");
    return streamed.length > 0 ? streamed : (stored.data?.output ?? "");
  }, [live.lines, stored.data?.output]);

  return {
    text,
    status: live.status ?? stored.data?.status ?? null,
    exitCode: live.exitCode ?? stored.data?.exitCode ?? null,
    truncated: stored.data?.outputTruncated ?? false,
    error: stored.error?.message ?? null,
  };
};
