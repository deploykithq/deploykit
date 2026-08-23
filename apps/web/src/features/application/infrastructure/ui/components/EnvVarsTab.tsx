import { memo } from "react";
import { Check, Eye, EyeOff } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { useEnvVarsTab } from "@application/infrastructure/ui/hooks/useEnvVarsTab";

interface EnvVarsTabPropsI {
  app: any;
  applicationId: string;
}

export const EnvVarsTab: React.FC<EnvVarsTabPropsI> = memo(function EnvVarsTab({
  app,
  applicationId,
}) {
  const {
    envText,
    setEnvText,
    saved,
    showValues,
    setShowValues,
    saving,
    handleSave,
  } = useEnvVarsTab(app, applicationId);

  const maskEnvValues = (text: string): string =>
    text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) return line;
        return trimmed.slice(0, eqIdx) + "=" + "•".repeat(8);
      })
      .join("\n");

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Environment Variables</h3>
          <div className="flex items-center gap-3">
            <p className="text-xs text-text-muted">
              KEY=VALUE format, one per line
            </p>
            <button
              type="button"
              onClick={() => setShowValues(!showValues)}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors px-2 py-1 rounded-md hover:bg-surface-2"
            >
              {showValues ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {showValues ? "Hide" : "Reveal"}
            </button>
          </div>
        </div>

        <textarea
          value={showValues ? envText : maskEnvValues(envText)}
          onChange={(e) => setEnvText(e.target.value)}
          onFocus={() => setShowValues(true)}
          rows={12}
          className="w-full px-4 py-3 rounded-lg bg-surface-2 border border-border text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          placeholder={`NODE_ENV=production\nDATABASE_URL=postgresql://...\nJWT_SECRET=my-secret`}
          spellCheck={false}
        />

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Environment"}
          </Button>
          {saved && (
            <span className="text-xs text-success flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          )}
        </div>

        <p className="text-xs text-text-muted">
          Variables are encrypted at rest. Changes require a redeploy to take
          effect.
        </p>
      </div>
    </Card>
  );
});
