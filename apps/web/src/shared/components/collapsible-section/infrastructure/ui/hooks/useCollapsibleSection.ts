import { useCallback, useState } from "react";

const PREFIX = "dk:section-open:";

function readOpen(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const stored = localStorage.getItem(PREFIX + storageKey);
    return stored === null ? defaultOpen : stored === "1";
  } catch {
    return defaultOpen;
  }
}

/**
 * Estado abierto/plegado de una sección, recordado por `storageKey` para que
 * sobreviva a la navegación y aplique igual en todos los proyectos.
 */
export function useCollapsibleSection(storageKey: string, defaultOpen: boolean) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PREFIX + storageKey, next ? "1" : "0");
      } catch {
        // Sin almacenamiento (modo privado, cuota): solo se pierde el recuerdo.
      }
      return next;
    });
  }, [storageKey]);

  return { open, toggle };
}
