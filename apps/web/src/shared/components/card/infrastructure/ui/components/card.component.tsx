import { memo } from "react";

import { cn } from "@lib/utils";

import type { CardPropsI } from "../interfaces/CardI";

export const Card: React.FC<CardPropsI> = memo(function Card({
  children,
  className,
  onClick,
  hoverable,
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-surface-1 border border-border rounded-xl p-4",
        hoverable &&
          "cursor-pointer hover:border-border-hover transition-colors",
        className,
      )}
    >
      {children}
    </div>
  );
});
