import { memo } from "react";
import { Layers, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { useImageCleanup } from "@server/infrastructure/ui/hooks/useImageCleanup";

import { fmtBytes } from "@server/infrastructure/ui/utils/server.utils";

import type { ImageCleanupPanelPropsI } from "@server/infrastructure/ui/interfaces/server.interfaces";

export const ImageCleanupPanel: React.FC<ImageCleanupPanelPropsI> = memo(
  function ImageCleanupPanel({ open, onClose }) {
    const {
      keep,
      setKeep,
      dryRun,
      setDryRun,
      results,
      setResults,
      totalRemoved,
      totalFreed,
      pruning,
      error,
      runPrune,
    } = useImageCleanup();

    if (!open) return null;

    return (
      <Card>
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Layers className="w-4 h-4 text-text-muted" />
                Docker image cleanup
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">
                Removes old{" "}
                <code className="font-mono text-[11px]">deploykit/*</code>{" "}
                images. Keeps the last N successful deployments per app for
                rollback.
              </p>
            </div>
            <button
              className="text-text-muted hover:text-text-primary transition-colors"
              onClick={() => {
                onClose();
                setResults(null);
              }}
            >
              ✕
            </button>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary whitespace-nowrap">
                Keep last
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={keep}
                onChange={(e) => setKeep(Math.max(1, Number(e.target.value)))}
                className="w-16 px-2 py-1 text-sm rounded-lg bg-surface-2 border border-border text-text-primary focus:outline-none focus:border-accent"
              />
              <label className="text-xs text-text-secondary whitespace-nowrap">
                images per app
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="rounded"
              />
              Dry run (preview only, don't delete)
            </label>
          </div>

          {/* Action */}
          <div className="flex items-center gap-3">
            <Button
              onClick={runPrune}
              disabled={pruning}
              variant={dryRun ? "secondary" : "primary"}
              size="sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {pruning ? "Running…" : dryRun ? "Preview" : "Clean now"}
            </Button>
            {results && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setResults(null)}
              >
                Clear results
              </Button>
            )}
          </div>

          {/* Error */}
          {error && <p className="text-xs text-danger">{error.message}</p>}

          {/* Results */}
          {results && (
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center gap-4 text-sm">
                <span
                  className={
                    totalRemoved > 0
                      ? "text-success font-medium"
                      : "text-text-muted"
                  }
                >
                  {dryRun ? "Would remove" : "Removed"} {totalRemoved} image
                  {totalRemoved !== 1 ? "s" : ""}
                </span>
                {!dryRun && totalFreed > 0 && (
                  <span className="text-text-secondary text-xs">
                    · freed {fmtBytes(totalFreed)}
                  </span>
                )}
              </div>

              <div className="space-y-1">
                {results.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <span
                      className={`shrink-0 ${r.imagesRemoved > 0 ? "text-text-primary" : "text-text-muted"}`}
                    >
                      {r.serverName}
                    </span>
                    <span className="text-text-secondary">
                      {r.imagesRemoved} removed
                      {r.bytesFreed > 0 && ` · ${fmtBytes(r.bytesFreed)} freed`}
                    </span>
                    {r.errors.length > 0 && (
                      <span className="text-warning">
                        {r.errors.length} error
                        {r.errors.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {results.some((r) => r.errors.length > 0) && (
                <details className="mt-1">
                  <summary className="text-xs text-text-muted cursor-pointer">
                    Show errors
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-danger font-mono">
                    {results
                      .flatMap((r) => r.errors)
                      .map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </Card>
    );
  },
);
