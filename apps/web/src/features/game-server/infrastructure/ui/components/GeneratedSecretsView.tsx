import { memo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, Eye, EyeOff } from "lucide-react";

import { Button } from "@shared/components/button";

import type { GeneratedSecretsViewPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * Secrets the API generated for blank fields, shown once — the same pattern as
 * a template's generated credentials.
 */
export const GeneratedSecretsView: React.FC<GeneratedSecretsViewPropsI> = memo(
  function GeneratedSecretsView({ secrets, started, onContinue }) {
    const [revealed, setRevealed] = useState(false);
    const entries = Object.entries(secrets);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm font-medium">
            {started
              ? "Game server created — provisioning…"
              : "Game server created — not started yet"}
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-secondary">
              Generated secrets
            </p>
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded-md hover:bg-surface-2"
            >
              {revealed ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {revealed ? "Hide" : "Reveal"}
            </button>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-900/10 p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-text-secondary">
              Copy these now. Afterwards they are stored encrypted and only
              shown to project members who may view secrets.
            </p>
          </div>

          {entries.map(([key, value]) => (
            <div key={key} className="bg-surface-2 rounded-lg px-3 py-2">
              <div className="text-[11px] text-text-muted font-mono mb-1">{key}</div>
              <div className="flex items-center gap-2">
                <code className="text-[11px] text-text-primary break-all flex-1">
                  {revealed ? value : "•".repeat(24)}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(value)}
                  className="text-text-muted hover:text-text-primary shrink-0"
                  title={`Copy ${key}`}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onContinue}>
            Open game server
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  },
);
