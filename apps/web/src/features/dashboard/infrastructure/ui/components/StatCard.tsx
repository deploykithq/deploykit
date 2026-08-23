import { memo } from "react";

import { Card } from "@shared/components/card";

import { ACCENT_STYLES } from "@dashboard/infrastructure/ui/constants/dashboard.constants";

interface StatCardPropsI {
  label: string;
  value: string | number;
  sub?: string;
  icon: any;
  accent?: "default" | "danger" | "warning";
  badge?: string;
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardPropsI> = memo(function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = "default",
  badge,
  onClick,
}) {
  return (
    <Card hoverable={!!onClick} onClick={onClick}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-text-muted">{label}</p>
          <p className="text-2xl font-semibold mt-1">{value}</p>
          {sub && <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>}
          {badge && (
            <span
              className={`inline-block text-[10px] font-medium mt-1.5 px-1.5 py-0.5 rounded ${
                accent === "danger"
                  ? "bg-danger/10 text-danger"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${ACCENT_STYLES[accent]}`}
        >
          <Icon className="w-4.5 h-4.5" />
        </div>
      </div>
    </Card>
  );
});
