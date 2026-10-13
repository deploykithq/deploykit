import { memo } from "react";
import { Check, FileText, X } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { useFileEditor } from "@game-server/infrastructure/ui/hooks/useFileEditor";

interface FileEditorPropsI {
  gameServerId: string;
  volume: string;
  path: string;
  canWrite: boolean;
  onClose: () => void;
}

export const FileEditor: React.FC<FileEditorPropsI> = memo(function FileEditor({
  gameServerId,
  volume,
  path,
  canWrite,
  onClose,
}) {
  const { text, setText, loading, loadError, dirty, save, saving, saveError, saved } =
    useFileEditor(gameServerId, volume, path);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-accent shrink-0" />
          <h3 className="text-sm font-medium font-mono truncate">
            {volume}:/{path}
          </h3>
          {dirty && <span className="text-[11px] text-warning shrink-0">unsaved</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} title="Close editor">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted py-6 text-center">Loading…</p>
      ) : loadError ? (
        <p className="text-sm text-danger py-6 text-center">{loadError}</p>
      ) : (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!canWrite}
            rows={22}
            spellCheck={false}
            className="w-full px-4 py-3 rounded-lg bg-surface-2 border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-accent resize-y"
          />

          {saveError && <p className="text-xs text-danger">{saveError}</p>}

          {canWrite ? (
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={save} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save file"}
              </Button>
              {saved && (
                <span className="text-xs text-success flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Saved
                </span>
              )}
              <span className="text-xs text-text-muted">
                Most games read their config at start-up — restart to apply.
              </span>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              Read-only: editing files needs the global operator role and
              operator access to this project.
            </p>
          )}
        </div>
      )}
    </Card>
  );
});
