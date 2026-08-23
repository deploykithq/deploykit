import { memo } from "react";

import { cn } from "@lib/utils";

import type { SelectPropsI } from "../interfaces/SelectI";

export const Select: React.FC<SelectPropsI> = memo(function Select({
  label,
  options,
  className,
  ...props
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="text-xs font-medium text-text-secondary">
          {label}
        </label>
      )}
      <select
        className={cn(
          "w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-primary",
          "focus:outline-none focus:border-accent transition-colors",
          className,
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
});
