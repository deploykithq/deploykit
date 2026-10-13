import { memo } from "react";

import { Input } from "@shared/components/input";

import { derivedHostPort } from "@game-server/infrastructure/ui/utils/game-server.utils";

import type { GamePortsFieldsPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * Host ports. A port that follows another (`offsetOf`, e.g. Valheim's query
 * port = game + 1) is not chosen: it is shown, derived, next to its base.
 */
export const GamePortsFields: React.FC<GamePortsFieldsPropsI> = memo(
  function GamePortsFields({ spec, ports, errors = {}, onChange, disabled }) {
    return (
      <div className="space-y-3">
        {spec.ports.map((p) => {
          const proto = p.protocol.toUpperCase();

          if (p.offsetOf !== undefined) {
            const host = derivedHostPort(p, ports);
            return (
              <div key={p.name} className="space-y-1">
                <p className="text-xs font-medium text-text-secondary">
                  {p.name}{" "}
                  <span className="text-text-muted font-normal">({proto})</span>
                </p>
                <div className="px-3 py-2 rounded-lg bg-surface-2/50 border border-border text-sm font-mono text-text-secondary">
                  {host ?? "—"}
                </div>
                <p className="text-[11px] text-text-muted">
                  Follows {p.offsetOf} ({p.offset !== undefined && p.offset >= 0 ? "+" : ""}
                  {p.offset}).{p.description ? ` ${p.description}` : ""}
                </p>
              </div>
            );
          }

          return (
            <div key={p.name} className="space-y-1">
              <Input
                label={`${p.name} (${proto}) — host port`}
                type="number"
                min={1}
                max={65535}
                value={ports[p.name] ?? ""}
                onChange={(e) => onChange(p.name, e.target.value)}
                disabled={disabled}
                className={errors[p.name] ? "border-danger" : undefined}
              />
              <p className="text-[11px] text-text-muted">
                {p.matchHost
                  ? "The server listens on this same port inside the container."
                  : `Forwarded to ${p.container}/${p.protocol} in the container.`}
                {p.description ? ` ${p.description}` : ""}
              </p>
              {errors[p.name] && (
                <p className="text-xs text-danger">{errors[p.name]}</p>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);
