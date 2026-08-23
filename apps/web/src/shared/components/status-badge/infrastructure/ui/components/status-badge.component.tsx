import { memo } from "react";

import { cn } from "@lib/utils";

import {
  ACTIVE_STATUSES,
  STATUS_DOT_COLORS,
  STATUS_DOT_FALLBACK,
} from "../constants/styles";

import type { StatusBadgePropsI } from "../interfaces/StatusBadgeI";

export const StatusBadge: React.FC<StatusBadgePropsI> = memo(
  function StatusBadge({ status }) {
    const dotColor = STATUS_DOT_COLORS[status] || STATUS_DOT_FALLBACK;
    const isActive = ACTIVE_STATUSES.includes(status);

    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            dotColor,
            isActive && "status-pulse",
          )}
        />
        {status}
      </span>
    );
  },
);
