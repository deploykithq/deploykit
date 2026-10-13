import { memo } from "react";

import {
  MEMORY_SLIDER_MAX_MB,
  MEMORY_STEP_MB,
} from "@game-server/infrastructure/ui/constants/game-server.constants";

import type { MemoryFieldPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

const formatMb = (mb: number) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;

/** Memory limit: a slider from the game's minimum, plus an exact input. */
export const MemoryField: React.FC<MemoryFieldPropsI> = memo(function MemoryField({
  min,
  recommended,
  value,
  onChange,
  disabled,
}) {
  const floor = Math.max(min, 256);
  const max = Math.max(MEMORY_SLIDER_MAX_MB, recommended * 2, value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-text-secondary">Memory</label>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={floor}
            max={65536}
            step={MEMORY_STEP_MB}
            value={value || ""}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className="w-24 px-2 py-1 rounded-md bg-surface-2 border border-border text-xs text-right font-mono focus:outline-none focus:border-accent"
          />
          <span className="text-xs text-text-muted">MB</span>
        </div>
      </div>
      <input
        type="range"
        min={floor}
        max={max}
        step={MEMORY_STEP_MB}
        value={value || floor}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full accent-[var(--color-accent)]"
      />
      <p className="text-[11px] text-text-muted">
        Minimum {formatMb(min)} · recommended {formatMb(recommended)}.
        {value > 0 && value < min && (
          <span className="text-danger"> Below the minimum this game needs.</span>
        )}
      </p>
    </div>
  );
});
