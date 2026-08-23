import { memo } from "react";

import { Card } from "@shared/components/card";

interface StatCardPropsI {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  barPercent: number;
  barColor: string;
}

export const StatCard: React.FC<StatCardPropsI> = memo(function StatCard({
  icon,
  label,
  value,
  subValue,
  barPercent,
  barColor,
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <p className="text-xs text-text-secondary">{label}</p>
      </div>
      <p className="text-2xl font-semibold">{value}</p>
      {subValue && <p className="text-xs text-text-muted">{subValue}</p>}
      <div className="mt-2 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all`}
          style={{ width: `${Math.min(barPercent, 100)}%` }}
        />
      </div>
    </Card>
  );
});
