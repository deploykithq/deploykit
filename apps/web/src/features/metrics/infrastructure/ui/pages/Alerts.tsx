import { memo } from "react";
import { Bell, BellOff, ChevronDown, ChevronRight, Plus } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { EmptyState } from "@shared/components/empty-state";

import {
  CreateRuleModal,
  EventRow,
  RuleCard,
  StatsBanner,
} from "@metrics/infrastructure/ui/components";

import { useAlerts } from "@metrics/infrastructure/ui/hooks/useAlerts";

export const AlertsPage: React.FC = memo(function AlertsPage() {
  const {
    showCreate,
    setShowCreate,
    showResolved,
    setShowResolved,
    rulesOpen,
    setRulesOpen,
    visibleEvents,
    eventsLoading,
    rules,
    rulesLoading,
  } = useAlerts();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Bell className="w-5 h-5 text-text-muted" />
            Alerts
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Threshold-based monitoring for all running services
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5" />
          New rule
        </Button>
      </div>

      <StatsBanner />

      {/* Event feed */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Recent events</h2>
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="rounded"
            />
            Show resolved
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs text-text-muted uppercase tracking-wide">
                <th className="px-4 py-2.5 text-left font-medium">Message</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Value</th>
                <th className="px-4 py-2.5 text-left font-medium">Service</th>
                <th className="px-4 py-2.5 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {eventsLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-text-muted"
                  >
                    Loading…
                  </td>
                </tr>
              ) : !visibleEvents?.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10">
                    <EmptyState
                      icon={<BellOff className="w-5 h-5" />}
                      title={showResolved ? "No events yet" : "No open alerts"}
                      description={
                        showResolved
                          ? "Events will appear here when rules fire."
                          : "All clear! Enable 'Show resolved' to see past events."
                      }
                    />
                  </td>
                </tr>
              ) : (
                visibleEvents.map((e) => <EventRow key={e.id} event={e} />)
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Rules section */}
      <div>
        <button
          className="flex items-center gap-2 text-sm font-medium text-text-primary mb-3 hover:text-accent transition-colors"
          onClick={() => setRulesOpen((o) => !o)}
        >
          {rulesOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Alert rules
          <span className="text-text-muted font-normal ml-1">
            ({rules?.length ?? 0})
          </span>
        </button>

        {rulesOpen && (
          <div className="space-y-2">
            {rulesLoading ? (
              <p className="text-sm text-text-muted">Loading…</p>
            ) : !rules?.length ? (
              <Card>
                <EmptyState
                  icon={<Bell className="w-5 h-5" />}
                  title="No alert rules yet"
                  description="Create a rule to get notified when CPU, memory or network metrics exceed your thresholds."
                  action={
                    <Button size="sm" onClick={() => setShowCreate(true)}>
                      <Plus className="w-3.5 h-3.5" />
                      Create first rule
                    </Button>
                  }
                />
              </Card>
            ) : (
              rules.map((rule) => <RuleCard key={rule.id} rule={rule} />)
            )}
          </div>
        )}
      </div>

      <CreateRuleModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {}}
      />
    </div>
  );
});
