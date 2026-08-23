import { memo } from "react";

import type { EmptyStatePropsI } from "../interfaces/EmptyStateI";

export const EmptyState: React.FC<EmptyStatePropsI> = memo(function EmptyState({
  icon,
  title,
  description,
  action,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center text-text-muted mb-4">
        {icon}
      </div>
      <h3 className="text-sm font-medium text-text-primary mb-1">{title}</h3>
      <p className="text-xs text-text-secondary mb-4 max-w-xs">{description}</p>
      {action}
    </div>
  );
});
