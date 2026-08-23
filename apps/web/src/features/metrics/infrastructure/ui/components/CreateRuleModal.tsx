import { memo } from "react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Select } from "@shared/components/select";

import { useCreateRuleForm } from "@metrics/infrastructure/ui/hooks/useCreateRuleForm";

import {
  CHANNEL_OPTIONS,
  METRIC_OPTIONS,
  OPERATOR_OPTIONS,
  SERVICE_TYPE_OPTIONS,
} from "@metrics/infrastructure/ui/constants/metrics.constants";

import type { CreateRuleModalPropsI } from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

export const CreateRuleModal: React.FC<CreateRuleModalPropsI> = memo(
  function CreateRuleModal({ open, onClose, onCreated }) {
    const { form, setForm, serviceOptions, creating, error, handleSubmit } =
      useCreateRuleForm(onCreated, onClose);

    const needsUrl = form.channel === "slack" || form.channel === "webhook";

    return (
      <Modal open={open} onClose={onClose} title="New alert rule">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Service type"
              value={form.serviceType}
              options={SERVICE_TYPE_OPTIONS}
              onChange={(e) =>
                setForm({
                  ...form,
                  serviceType: e.target.value as any,
                  serviceId: "",
                })
              }
            />

            <Select
              label="Service"
              value={form.serviceId}
              options={[
                { value: "", label: "Select service…" },
                ...serviceOptions,
              ]}
              onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Select
              label="Metric"
              value={form.metric}
              options={METRIC_OPTIONS}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
            />

            <Select
              label="Condition"
              value={form.operator}
              options={OPERATOR_OPTIONS}
              onChange={(e) => setForm({ ...form, operator: e.target.value })}
            />

            <Input
              label="Threshold (%)"
              type="number"
              min={0}
              max={100}
              value={form.threshold}
              onChange={(e) =>
                setForm({ ...form, threshold: Number(e.target.value) })
              }
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Notification channel"
              value={form.channel}
              options={CHANNEL_OPTIONS}
              onChange={(e) => setForm({ ...form, channel: e.target.value })}
            />

            <Input
              label="Cooldown (minutes)"
              type="number"
              min={1}
              max={1440}
              value={form.cooldown}
              onChange={(e) =>
                setForm({ ...form, cooldown: Number(e.target.value) })
              }
            />
          </div>

          {needsUrl && (
            <Input
              label={
                form.channel === "slack" ? "Slack webhook URL" : "Webhook URL"
              }
              type="url"
              value={form.channelUrl}
              onChange={(e) => setForm({ ...form, channelUrl: e.target.value })}
              placeholder="https://"
              required
            />
          )}

          {error && (
            <p className="text-sm text-danger">{error.message}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={creating || !form.serviceId}
            >
              {creating ? "Creating…" : "Create rule"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
