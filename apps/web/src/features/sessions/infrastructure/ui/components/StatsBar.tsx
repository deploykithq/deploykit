import { Users, MonitorSmartphone, History } from "lucide-react";

import { Card } from "@shared/components/card";

import { useSessionStats } from "@sessions/infrastructure/ui/hooks/useSessionStats";

export const StatsBar = () => {
  const { stats } = useSessionStats();

  if (!stats) return null;

  const cards = [
    {
      label: "Active sessions",
      value: stats.activeSessions,
      icon: MonitorSmartphone,
    },
    { label: "Active users", value: stats.activeUsers, icon: Users },
    { label: "Ended (7d)", value: stats.expired7d, icon: History },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs text-text-secondary">{card.label}</p>
              <p className="text-2xl font-semibold mt-1">{card.value}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center text-text-muted">
              <card.icon className="w-5 h-5" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
