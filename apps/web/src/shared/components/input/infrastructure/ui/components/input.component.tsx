import { memo } from "react";

import { cn } from "@lib/utils";

import type { InputPropsI } from "../interfaces/InputI";

export const Input: React.FC<InputPropsI> = memo(function Input({
  label,
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
      <input
        className={cn(
          "w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-primary",
          "placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors",
          className,
        )}
        {...props}
      />
    </div>
  );
});
