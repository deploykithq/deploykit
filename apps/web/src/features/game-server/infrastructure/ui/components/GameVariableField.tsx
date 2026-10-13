import { memo } from "react";
import { Lock } from "lucide-react";

import { Input } from "@shared/components/input";
import { Select } from "@shared/components/select";

import { cn } from "@lib/utils";

import type { GameVariableFieldPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** One field of a game's settings form, rendered from its variable definition. */
export const GameVariableField: React.FC<GameVariableFieldPropsI> = memo(
  function GameVariableField({ variable: v, value, error, onChange, mode, disabled }) {
    // A non-editable setting (a world seed) is fixed once the server exists.
    const locked = mode === "update" && !v.editable;
    const isDisabled = disabled || locked;

    const placeholder =
      v.secret && mode === "update"
        ? "Leave blank to keep the current value"
        : v.secret && v.generator
          ? "Leave blank to generate"
          : v.default !== undefined
            ? String(v.default)
            : undefined;

    const hint = (
      <>
        {v.description && (
          <p className="text-[11px] text-text-muted">{v.description}</p>
        )}
        {locked && (
          <p className="text-[11px] text-text-muted flex items-center gap-1">
            <Lock className="w-3 h-3" /> Fixed after creation
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </>
    );

    if (v.type === "boolean") {
      const checked = value === true;
      return (
        <div className="space-y-1">
          <label
            className={cn(
              "flex items-center gap-3",
              isDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
            )}
          >
            <button
              type="button"
              role="switch"
              aria-checked={checked}
              disabled={isDisabled}
              onClick={() => onChange(!checked)}
              className={cn(
                "w-9 h-5 rounded-full transition-colors relative shrink-0",
                checked ? "bg-accent" : "bg-surface-3",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                  checked ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
            <span className="text-sm">
              {v.label}
              {v.required && <span className="text-danger ml-0.5">*</span>}
            </span>
          </label>
          {hint}
        </div>
      );
    }

    const label = `${v.label}${v.required ? " *" : ""}`;

    if (v.type === "select") {
      return (
        <div className="space-y-1">
          <Select
            label={label}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={isDisabled}
            options={[
              ...(v.required || v.default !== undefined
                ? []
                : [{ value: "", label: "—" }]),
              ...(v.options ?? []),
            ]}
          />
          {hint}
        </div>
      );
    }

    return (
      <div className="space-y-1">
        <Input
          label={label}
          type={v.type === "number" ? "number" : v.secret ? "password" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={isDisabled}
          min={v.type === "number" ? v.min : undefined}
          max={v.type === "number" ? v.max : undefined}
          maxLength={v.type === "string" ? v.maxLength : undefined}
          autoComplete={v.secret ? "new-password" : "off"}
          className={cn(error && "border-danger")}
        />
        {hint}
      </div>
    );
  },
);
