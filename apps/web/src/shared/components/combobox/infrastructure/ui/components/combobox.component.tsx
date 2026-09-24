import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@lib/utils";

import type { ComboboxPropsI } from "../interfaces/ComboboxI";

/**
 * A filterable single-select.
 *
 * A plain `<Select>` is unusable once a list runs to hundreds of entries,
 * which is the normal size of an organization's repository list.
 */
export const Combobox: React.FC<ComboboxPropsI> = memo(function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = "Search...",
  loading = false,
  disabled = false,
  emptyLabel = "No matches",
  note,
  id,
}) {
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [highlighted, setHighlighted] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.hint?.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Clicking anywhere else closes the list and discards the half-typed filter.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  const commit = (optionValue: string) => {
    onChange(optionValue);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setHighlighted((i) => {
        if (filtered.length === 0) return 0;
        return (i + delta + filtered.length) % filtered.length;
      });
      return;
    }

    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const option = filtered[highlighted];
      if (option) commit(option.value);
      return;
    }

    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="space-y-1.5" ref={containerRef}>
      {label && (
        <label
          className="text-xs font-medium text-text-secondary"
          htmlFor={id}
        >
          {label}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
          disabled={disabled}
          // Closed, the field reads as the current selection; open, it is the
          // filter. One input, so there is never a stale value on screen.
          value={open ? query : (selected?.label ?? "")}
          placeholder={selected ? selected.label : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full pl-3 pr-8 py-2 rounded-lg bg-surface-2 border border-border text-sm",
            "text-text-primary placeholder:text-text-muted",
            "focus:outline-none focus:border-accent transition-colors",
            disabled && "opacity-60 cursor-not-allowed",
          )}
        />

        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </span>

        {open && !disabled && (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border bg-surface-1 shadow-lg"
          >
            {loading && filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-text-muted">Loading...</li>
            )}

            {!loading && filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-text-muted">
                {emptyLabel}
              </li>
            )}

            {filtered.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => commit(option.value)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                    index === highlighted
                      ? "bg-surface-2 text-text-primary"
                      : "text-text-secondary",
                  )}
                >
                  <Check
                    className={cn(
                      "w-3.5 h-3.5 shrink-0",
                      option.value === value ? "text-accent" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                  {option.hint && (
                    <span className="ml-auto text-[11px] text-text-muted shrink-0">
                      {option.hint}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {note && <p className="text-[11px] text-text-muted">{note}</p>}
    </div>
  );
});
