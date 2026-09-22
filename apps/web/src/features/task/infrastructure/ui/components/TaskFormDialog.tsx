import { memo, useState } from "react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Select } from "@shared/components/select";

import { trpc } from "@lib/trpc";

import {
  CRON_CUSTOM,
  CRON_PRESETS,
} from "@task/infrastructure/ui/constants/task.constants";

import type {
  TaskFormValuesI,
  TaskSubmitValuesT,
} from "@task/infrastructure/ui/interfaces/task.interfaces";

interface TaskFormDialogPropsI {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  initial?: Partial<TaskFormValuesI>;
  /** Compose services to choose from; only passed for a stack target. */
  services?: string[];
  busy?: boolean;
  onSubmit: (values: TaskSubmitValuesT) => void;
}

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const TaskFormDialog: React.FC<TaskFormDialogPropsI> = memo(
  function TaskFormDialog({
    open,
    onClose,
    initial,
    services,
    busy,
    onSubmit,
  }) {
    const initialCron = initial?.cron ?? "";
    const isPreset = CRON_PRESETS.some((p) => p.value === initialCron);

    const [name, setName] = useState(initial?.name ?? "");
    const [command, setCommand] = useState(initial?.command ?? "");
    const [preset, setPreset] = useState(isPreset ? initialCron : CRON_CUSTOM);
    const [cron, setCron] = useState(initialCron);
    const [timezone, setTimezone] = useState(
      initial?.timezone ?? browserTimezone(),
    );
    const [timeoutSeconds, setTimeoutSeconds] = useState(
      initial?.timeoutSeconds ?? 300,
    );
    const [enabled, setEnabled] = useState(initial?.enabled ?? true);
    const [serviceName, setServiceName] = useState(
      initial?.serviceName ?? services?.[0] ?? "",
    );

    // The API validates with the same parser BullMQ schedules with, so this
    // preview is exactly what will happen — including the error message.
    const preview = trpc.task.previewCron.useQuery(
      { cron, timezone },
      { enabled: open && cron.length > 0, retry: false },
    );

    const submit = (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit({
        name,
        command,
        cron: cron === "" ? null : cron,
        timezone,
        timeoutSeconds,
        enabled,
        serviceName,
      });
    };

    return (
      <Modal
        open={open}
        onClose={onClose}
        title={initial ? "Edit task" : "New task"}
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Run migrations"
            required
          />

          {services && services.length > 0 && (
            <Select
              label="Service"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              options={services.map((s) => ({ value: s, label: s }))}
              required
            />
          )}

          <Input
            label="Command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="php artisan migrate --force"
            className="font-mono"
            required
          />

          <Select
            label="Schedule"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              if (e.target.value !== CRON_CUSTOM) setCron(e.target.value);
            }}
            options={[
              ...CRON_PRESETS,
              { value: CRON_CUSTOM, label: "Custom…" },
            ]}
          />

          {preset === CRON_CUSTOM && (
            <Input
              label="Cron expression"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 2 * * *"
              className="font-mono"
            />
          )}

          {cron.length > 0 && (
            <>
              <Input
                label="Time zone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="UTC"
              />
              <p className="text-xs text-text-muted">
                {preview.error
                  ? preview.error.message
                  : preview.data
                    ? `Next runs: ${preview.data
                        .map((d) => new Date(d).toLocaleString())
                        .join(", ")}`
                    : "Checking schedule…"}
              </p>
            </>
          )}

          <Input
            label="Timeout (seconds)"
            type="number"
            min={1}
            max={86400}
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
          />

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {initial ? "Save" : "Create task"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
