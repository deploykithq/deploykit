import { memo, useId } from "react";
import { ChevronRight } from "lucide-react";

import type { CollapsibleSectionPropsI } from "../interfaces/CollapsibleSectionI";
import { useCollapsibleSection } from "../hooks/useCollapsibleSection";

export const CollapsibleSection: React.FC<CollapsibleSectionPropsI> = memo(
  function CollapsibleSection({
    title,
    storageKey,
    children,
    count,
    actions,
    defaultOpen = false,
  }) {
    const { open, toggle } = useCollapsibleSection(storageKey, defaultOpen);
    const contentId = useId();

    return (
      <section>
        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={contentId}
            className="group flex items-center gap-1.5 -ml-1 px-1 py-0.5 rounded text-xs font-medium text-text-muted uppercase tracking-wider hover:text-text-primary transition-colors"
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            />
            <h2>{title}</h2>
            {count !== undefined && (
              <span className="ml-1 px-1.5 rounded bg-surface-2 text-[10px] tabular-nums normal-case tracking-normal">
                {count}
              </span>
            )}
          </button>
          {actions}
        </div>

        <div
          id={contentId}
          inert={!open}
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          {/* El margen negativo deja sitio a sombras y anillos de foco que el
              overflow recortaría. */}
          <div className="min-h-0 overflow-hidden -m-1 p-1">{children}</div>
        </div>
      </section>
    );
  },
);
