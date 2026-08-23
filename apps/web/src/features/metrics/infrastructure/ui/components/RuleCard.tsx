import { memo } from "react";
import { ToggleLeft, ToggleRight, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@shared/components/confirm-dialog";

import { useRuleCard } from "@metrics/infrastructure/ui/hooks/useRuleCard";

import {
  CHANNEL_LABELS,
  METRIC_LABELS,
} from "@metrics/infrastructure/ui/constants/metrics.constants";

import type { RuleCardPropsI } from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

export const RuleCard: React.FC<RuleCardPropsI> = memo(function RuleCard({
  rule,
}) {
  const { deleteOpen, setDeleteOpen, deleting, toggleRule, deleteRule } =
    useRuleCard();

  const opLabel = rule.operator === "gt" ? ">" : "<";
  const metricLabel = METRIC_LABELS[rule.metric] ?? rule.metric;
  const channelLabel = CHANNEL_LABELS[rule.channel] ?? rule.channel;

  return (
    <>
      <div
        className={`border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 ${!rule.enabled ? "opacity-60" : ""}`}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {rule.serviceName ?? rule.serviceId?.slice(0, 8)}
            <span className="text-text-muted font-normal ml-1">
              ({rule.serviceType})
            </span>
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            {metricLabel} {opLabel} {rule.threshold}%
            <span className="mx-1.5 text-text-muted">·</span>
            {channelLabel}
            <span className="mx-1.5 text-text-muted">·</span>
            {rule.cooldownMinutes}min cooldown
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            className="text-text-muted hover:text-text-primary transition-colors"
            onClick={() => toggleRule(rule.id, !rule.enabled)}
            title={rule.enabled ? "Disable rule" : "Enable rule"}
          >
            {rule.enabled ? (
              <ToggleRight className="w-5 h-5 text-accent" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
          </button>
          <button
            className="text-text-muted hover:text-danger transition-colors"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteRule(rule.id)}
        title="Delete alert rule"
        description={`Remove the alert rule for "${rule.serviceName ?? rule.serviceId}"? Existing events won't be deleted.`}
        confirmText="Delete rule"
        isPending={deleting}
      />
    </>
  );
});
