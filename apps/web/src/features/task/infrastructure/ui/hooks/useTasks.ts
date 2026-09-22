import { useState } from "react";

import { trpc } from "@lib/trpc";

import { RUNS_REFETCH_MS } from "@task/infrastructure/ui/constants/task.constants";

import type { TaskTargetI } from "@deploykit/shared";

export const useTasks = (target: TaskTargetI) => {
  const utils = trpc.useUtils();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tasks = trpc.task.list.useQuery({ target });
  const runs = trpc.task.runs.useQuery(
    { target, limit: 25 },
    {
      // Only poll while something is actually running.
      refetchInterval: (query) =>
        query.state.data?.some((r) => r.status === "running")
          ? RUNS_REFETCH_MS
          : false,
    },
  );

  const invalidate = () => {
    utils.task.list.invalidate({ target });
    utils.task.runs.invalidate({ target });
  };

  const onError = (err: { message: string }) => setError(err.message);

  const create = trpc.task.create.useMutation({
    onSuccess: invalidate,
    onError,
  });
  const update = trpc.task.update.useMutation({
    onSuccess: invalidate,
    onError,
  });
  const remove = trpc.task.delete.useMutation({
    onSuccess: invalidate,
    onError,
  });
  const runNow = trpc.task.runNow.useMutation({
    onSuccess: (run) => {
      setActiveRunId(run.id);
      invalidate();
    },
    onError,
  });
  const runAdHoc = trpc.task.runAdHoc.useMutation({
    onSuccess: (run) => {
      setActiveRunId(run.id);
      invalidate();
    },
    onError,
  });

  return {
    tasks: tasks.data ?? [],
    isLoading: tasks.isLoading,
    runs: runs.data ?? [],
    activeRunId,
    setActiveRunId,
    error,
    dismissError: () => setError(null),
    create,
    update,
    remove,
    runNow,
    runAdHoc,
  };
};
