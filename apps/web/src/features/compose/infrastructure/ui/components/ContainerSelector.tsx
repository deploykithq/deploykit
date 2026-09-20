import { memo } from "react";
import { Box } from "lucide-react";

import { cn } from "@lib/utils";

import type { ContainerSelectorPropsI } from "@compose/infrastructure/ui/interfaces/compose.interfaces";

/**
 * Selector de contenedor dentro del stack.
 *
 * Una aplicación tiene un contenedor y no necesita nada de esto; un stack tiene
 * varios, así que las pestañas de logs y terminal necesitan saber a cuál se
 * refieren.
 */
export const ContainerSelector: React.FC<ContainerSelectorPropsI> = memo(
  function ContainerSelector({ containers, value, onChange, emptyLabel }) {
    if (containers.length === 0) {
      return (
        <span className="text-xs text-text-muted">
          {emptyLabel ?? "No containers yet — deploy the stack first."}
        </span>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {containers.map((container) => {
          const isRunning = container.state === "running";
          return (
            <button
              key={container.id}
              type="button"
              onClick={() => onChange(container.id)}
              title={`${container.name} (${container.state})`}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors",
                value === container.id
                  ? "bg-surface-2 border-accent text-text-primary"
                  : "border-border text-text-secondary hover:text-text-primary",
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  isRunning ? "bg-success" : "bg-text-muted",
                )}
              />
              <Box className="w-3 h-3" />
              <span className="font-mono">{container.name}</span>
            </button>
          );
        })}
      </div>
    );
  },
);
