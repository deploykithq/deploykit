import { memo } from "react";
import { Check, Download, RefreshCw } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { Modal } from "@shared/components/modal";

import { useImageUpdate } from "@game-server/infrastructure/ui/hooks/useImageUpdate";

import type { ImageUpdateCardPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * The image the server runs, and an update when its game has a newer one:
 * the catalogue moved to a new tag, or the same tag has a new build.
 */
export const ImageUpdateCard: React.FC<ImageUpdateCardPropsI> = memo(function ImageUpdateCard({
  server,
  busy,
}) {
  const u = useImageUpdate(server);
  const d = u.data;

  const status = !d
    ? u.loading
      ? "Checking for updates…"
      : u.checkError
    : d.specImage
      ? `The game now uses ${d.target}.`
      : d.newBuild
        ? `A newer build of ${d.target} is available.`
        : d.newBuild === false
          ? "Up to date."
          : "Up to date with the catalogue. Whether the registry has a newer build of this tag is unknown.";

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Image</h3>
          <p className="text-xs font-mono text-text-secondary mt-1 break-all">
            {d?.current ?? server.image ?? server.spec.image}
          </p>
          {status && (
            <p
              className={
                d?.available ? "text-xs text-warning mt-1" : "text-xs text-text-muted mt-1"
              }
            >
              {status}
            </p>
          )}
          {u.note && (
            <p className="text-xs text-success flex items-center gap-1 mt-2">
              <Check className="w-3.5 h-3.5" /> {u.note}
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={u.recheck}
            disabled={u.rechecking}
            aria-label="Check for image updates"
          >
            <RefreshCw className={u.rechecking ? "w-3.5 h-3.5 animate-spin" : "w-3.5 h-3.5"} />
          </Button>
          {d?.available && d.canEdit && (
            <Button type="button" size="sm" onClick={() => u.setOpen(true)} disabled={busy}>
              <Download className="w-3.5 h-3.5" />
              Update image
            </Button>
          )}
        </div>
      </div>

      <Modal open={u.open} onClose={() => u.setOpen(false)} title="Update image">
        <div className="space-y-4">
          {d && (
            <div className="text-xs space-y-1">
              <p className="text-text-muted">From</p>
              <p className="font-mono break-all">{d.current}</p>
              <p className="text-text-muted pt-1">To</p>
              <p className="font-mono break-all">
                {d.target}
                {!d.specImage && " (newer build)"}
              </p>
            </div>
          )}
          <p className="text-xs text-text-secondary">
            The new image is pulled first; then the container is recreated with it, so a running
            server restarts and disconnects its players. A stopped server stays stopped. World, mods
            and settings are kept.
          </p>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={u.safetyBackup}
              onChange={(e) => u.setSafetyBackup(e.target.checked)}
              className="mt-0.5 rounded border-border bg-surface-2 text-accent focus:ring-accent"
            />
            <span>Back up the world first</span>
          </label>
          {u.error && <p className="text-xs text-danger whitespace-pre-wrap">{u.error}</p>}
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => u.setOpen(false)}
              disabled={u.pending}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={u.update} disabled={u.pending}>
              {u.pending ? "Queuing…" : "Update image"}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
});
