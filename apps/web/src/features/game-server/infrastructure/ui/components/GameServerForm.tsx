import { memo, useMemo } from "react";

import { GameVariableField } from "@game-server/infrastructure/ui/components/GameVariableField";

import { groupVariables } from "@game-server/infrastructure/ui/utils/game-server.utils";

import type { GameServerFormPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * The game's variables as a form, one section per `group`. Used both to create
 * a server and to edit it; in update mode non-editable fields are disabled and
 * a blank secret keeps its current value.
 */
export const GameServerForm: React.FC<GameServerFormPropsI> = memo(
  function GameServerForm({ spec, values, errors, onChange, mode, disabled, hiddenKeys }) {
    const visible = useMemo(
      () => spec.variables.filter((v) => !hiddenKeys?.includes(v.key)),
      [spec.variables, hiddenKeys],
    );
    const groups = useMemo(() => groupVariables(visible), [visible]);

    if (visible.length === 0) {
      return (
        <p className="text-xs text-text-muted">
          This game has no settings to choose.
        </p>
      );
    }

    return (
      <div className="space-y-5">
        {groups.map(({ group, items }) => (
          <fieldset key={group ?? "_"} className="space-y-3">
            {group && (
              <legend className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                {group}
              </legend>
            )}
            {items.map((v) => (
              <GameVariableField
                key={v.key}
                variable={v}
                value={values[v.key]}
                error={errors[v.key]}
                onChange={(value) => onChange(v.key, value)}
                mode={mode}
                disabled={disabled}
              />
            ))}
          </fieldset>
        ))}
      </div>
    );
  },
);
