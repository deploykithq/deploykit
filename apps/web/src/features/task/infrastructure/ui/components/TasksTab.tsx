import { memo, useState } from "react";
import { Play, Pencil, Power, Trash2, Plus } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { Input } from "@shared/components/input";

import { TaskFormDialog } from "@task/infrastructure/ui/components/TaskFormDialog";
import { RunOutputDialog } from "@task/infrastructure/ui/components/RunOutputDialog";

import { useTasks } from "@task/infrastructure/ui/hooks/useTasks";

import { cn, timeAgo } from "@lib/utils";

import {
  ADHOC_TIMEOUT_DEFAULT,
  STATUS_STYLES,
} from "@task/infrastructure/ui/constants/task.constants";

import type {
  TaskSubmitValuesT,
  TasksTabPropsI,
} from "@task/infrastructure/ui/interfaces/task.interfaces";

type TaskRowT = ReturnType<typeof useTasks>["tasks"][number];

export const TasksTab: React.FC<TasksTabPropsI> = memo(function TasksTab({
  target,
  services,
}) {
  const {
    tasks,
    isLoading,
    runs,
    activeRunId,
    setActiveRunId,
    error,
    dismissError,
    create,
    update,
    remove,
    runNow,
    runAdHoc,
  } = useTasks(target);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRowT | null>(null);
  const [deleting, setDeleting] = useState<TaskRowT | null>(null);
  const [adHocCommand, setAdHocCommand] = useState("");
  const [adHocTimeout, setAdHocTimeout] = useState(ADHOC_TIMEOUT_DEFAULT);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (task: TaskRowT) => {
    setEditing(task);
    setFormOpen(true);
  };

  const submitForm = (values: TaskSubmitValuesT) => {
    if (editing) {
      update.mutate({
        id: editing.id,
        name: values.name,
        command: values.command,
        cron: values.cron,
        timezone: values.timezone,
        enabled: values.enabled,
        timeoutSeconds: values.timeoutSeconds,
      });
    } else {
      create.mutate({
        // A stack task may target a different service than the tab's default.
        target:
          target.kind === "compose"
            ? { ...target, serviceName: values.serviceName || target.serviceName }
            : target,
        name: values.name,
        command: values.command,
        cron: values.cron,
        timezone: values.timezone,
        enabled: values.enabled,
        timeoutSeconds: values.timeoutSeconds,
      });
    }
    setFormOpen(false);
  };

  const submitAdHoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adHocCommand.trim()) return;
    runAdHoc.mutate({
      target,
      command: adHocCommand,
      timeoutSeconds: adHocTimeout,
    });
    setAdHocCommand("");
  };

  const activeRun = runs.find((r) => r.id === activeRunId);

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
        >
          <span className="break-all">{error}</span>
          <button
            onClick={dismissError}
            className="shrink-0 text-xs underline"
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Tasks</h3>
          <Button size="sm" onClick={openNew}>
            <Plus className="w-3.5 h-3.5" />
            New task
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-text-muted py-4 text-center">Loading…</p>
        ) : !tasks.length ? (
          <p className="text-sm text-text-muted py-4 text-center">
            No tasks yet. Create one to run a command on a schedule, or save a
            command to run on demand.
          </p>
        ) : (
          <div className="space-y-1">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {task.name}
                    </span>
                    {task.lastStatus && (
                      <span
                        className={cn(
                          "text-xs",
                          STATUS_STYLES[task.lastStatus] ??
                            "text-text-secondary",
                        )}
                      >
                        {task.lastStatus}
                      </span>
                    )}
                    {!task.enabled && (
                      <span className="text-xs text-text-muted">disabled</span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-text-secondary truncate">
                    {task.command}
                  </p>
                  <p className="text-xs text-text-muted">
                    {task.cron ? (
                      <>
                        {task.cron} · {task.timezone}
                        {task.nextRunAt
                          ? ` · next ${new Date(task.nextRunAt).toLocaleString()}`
                          : ""}
                      </>
                    ) : (
                      "Manual only"
                    )}
                    {task.serviceName ? ` · ${task.serviceName}` : ""}
                    {task.lastRunAt ? ` · ran ${timeAgo(task.lastRunAt)}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Run now"
                    disabled={runNow.isPending}
                    onClick={() => runNow.mutate({ id: task.id })}
                  >
                    <Play className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Edit"
                    onClick={() => openEdit(task)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={task.enabled ? "Disable" : "Enable"}
                    onClick={() =>
                      update.mutate({ id: task.id, enabled: !task.enabled })
                    }
                  >
                    <Power className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Delete"
                    onClick={() => setDeleting(task)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-medium mb-3">Run a command</h3>
        <form
          onSubmit={submitAdHoc}
          className="flex flex-col sm:flex-row sm:items-end gap-2"
        >
          <div className="flex-1">
            <Input
              label="Command"
              value={adHocCommand}
              onChange={(e) => setAdHocCommand(e.target.value)}
              placeholder="php artisan migrate --force"
              className="font-mono"
            />
          </div>
          <div className="sm:w-32">
            <Input
              label="Timeout (s)"
              type="number"
              min={1}
              max={86400}
              value={adHocTimeout}
              onChange={(e) => setAdHocTimeout(Number(e.target.value))}
            />
          </div>
          <Button type="submit" disabled={runAdHoc.isPending}>
            <Play className="w-3.5 h-3.5" />
            Run
          </Button>
        </form>
        <p className="text-xs text-text-muted mt-2">
          Runs in a new container from this service&apos;s image. The command
          runs through /bin/sh -lc.
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-medium mb-3">Run history</h3>
        {!runs.length ? (
          <p className="text-sm text-text-muted py-4 text-center">
            Nothing has run yet.
          </p>
        ) : (
          <div className="space-y-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setActiveRunId(run.id)}
                className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-lg text-left hover:bg-surface-2 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs",
                        STATUS_STYLES[run.status] ?? "text-text-secondary",
                      )}
                    >
                      {run.status}
                    </span>
                    <span className="text-sm truncate">
                      {run.taskName ?? "Ad-hoc"}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-text-secondary truncate">
                    {run.command}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted shrink-0">
                  {run.exitCode !== null && <span>exit {run.exitCode}</span>}
                  {run.durationMs !== null && (
                    <span>{Math.round(run.durationMs / 1000)}s</span>
                  )}
                  <span>{timeAgo(run.startedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {formOpen && (
        <TaskFormDialog
          // Remount on target change so the form starts from the right values.
          key={editing?.id ?? "new"}
          open={formOpen}
          onClose={() => setFormOpen(false)}
          services={services}
          busy={create.isPending || update.isPending}
          initial={
            editing
              ? {
                  name: editing.name,
                  command: editing.command,
                  cron: editing.cron ?? "",
                  timezone: editing.timezone,
                  timeoutSeconds: editing.timeoutSeconds,
                  enabled: editing.enabled,
                  serviceName: editing.serviceName ?? "",
                }
              : undefined
          }
          onSubmit={submitForm}
        />
      )}

      <RunOutputDialog
        runId={activeRunId}
        command={activeRun?.command}
        onClose={() => setActiveRunId(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete task"
        description={`This permanently deletes "${deleting?.name}" and unschedules it. Its run history is kept.`}
        confirmText="Delete task"
        onConfirm={() => {
          if (deleting) remove.mutate({ id: deleting.id });
          setDeleting(null);
        }}
      />
    </div>
  );
});
