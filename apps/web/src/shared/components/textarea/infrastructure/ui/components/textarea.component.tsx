import { memo } from "react";

import { cn } from "@lib/utils";

import type { TextareaPropsI } from "../interfaces/TextareaI";

export const Textarea: React.FC<TextareaPropsI> = memo(function Textarea({
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
      <textarea
        className={cn(
          "w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-primary",
          "placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors resize-none",
          className,
        )}
        {...props}
      />
    </div>
  );
});
