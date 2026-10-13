import { memo, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  File,
  FileCog,
  Folder,
  FolderPlus,
  Link2,
  Pencil,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";

import { FileEditor } from "@game-server/infrastructure/ui/components/FileEditor";

import { useGameFiles } from "@game-server/infrastructure/ui/hooks/useGameFiles";

import { cn, formatBytes, timeAgo } from "@lib/utils";
import { joinPath } from "@game-server/infrastructure/ui/utils/game-server.utils";

import { EDITABLE_MAX_BYTES } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type {
  GameFileEntryT,
  GameServerTabPropsI,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

type NameDialogT = { kind: "mkdir" } | { kind: "rename"; target: string; current: string };

const ENTRY_ICON: Record<GameFileEntryT["type"], React.ElementType> = {
  directory: Folder,
  file: File,
  symlink: Link2,
  other: File,
};

export const FilesTab: React.FC<GameServerTabPropsI> = memo(function FilesTab({
  server,
  permissions,
}) {
  const files = useGameFiles(server, permissions.canViewSecrets);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogT | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const canWrite = permissions.canExecute;

  if (!permissions.canViewSecrets) {
    return (
      <Card>
        <div className="flex flex-col items-center py-8 text-center">
          <Shield className="w-8 h-8 text-text-muted mb-3" />
          <p className="text-sm text-text-secondary">
            Server files are restricted to members who may view secrets.
          </p>
          <p className="text-xs text-text-muted mt-1">
            Config files hold passwords such as the RCON password.
          </p>
        </div>
      </Card>
    );
  }

  if (files.volumes.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-muted">
          This game does not expose any of its volumes for browsing.
        </p>
      </Card>
    );
  }

  const segments = files.path ? files.path.split("/") : [];

  const openNameDialog = (dialog: NameDialogT) => {
    setNameDialog(dialog);
    setNameValue(dialog.kind === "rename" ? dialog.current : "");
  };

  const submitName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDialog || !nameValue.trim()) return;
    try {
      if (nameDialog.kind === "mkdir") await files.mkdir(nameValue.trim());
      else await files.rename(nameDialog.target, nameValue.trim());
      setNameDialog(null);
    } catch {
      // Shown from mutationError.
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await files.remove(deleteTarget);
      if (files.editing === deleteTarget) files.setEditing(null);
    } catch {
      // Shown from mutationError.
    }
    setDeleteTarget(null);
  };

  const openEntry = (entry: GameFileEntryT) => {
    const target = joinPath(files.path, entry.name);
    if (entry.type === "directory") {
      files.setPath(target);
      files.setEditing(null);
    } else if (entry.type === "file" && entry.size <= EDITABLE_MAX_BYTES) {
      files.setEditing(target);
    } else {
      void files.download(target, false);
    }
  };

  return (
    <div className="space-y-4">
      {server.spec.configFiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-muted mr-1">Config files:</span>
          {server.spec.configFiles.map((f) => (
            <button
              key={`${f.volume}:${f.path}`}
              type="button"
              onClick={() => files.openFile(f.volume, f.path)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors",
                files.editing === f.path && files.volume === f.volume
                  ? "bg-accent-muted border-accent text-text-primary"
                  : "border-border text-text-secondary hover:text-text-primary",
              )}
              title={`${f.volume}:/${f.path}`}
            >
              <FileCog className="w-3 h-3" />
              {f.label}
            </button>
          ))}
        </div>
      )}

      <Card>
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {files.volumes.length > 1 ? (
              <select
                value={files.volume}
                onChange={(e) => files.setVolume(e.target.value)}
                className="px-2 py-1 rounded-md bg-surface-2 border border-border text-xs focus:outline-none focus:border-accent"
              >
                {files.volumes.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-mono text-text-secondary">
                {files.volume}
              </span>
            )}

            {/* Breadcrumb */}
            <nav className="flex items-center gap-0.5 text-xs font-mono min-w-0 flex-wrap">
              <button
                type="button"
                onClick={() => files.setPath("")}
                className="text-accent hover:underline px-1"
              >
                /
              </button>
              {segments.map((seg, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  <ChevronRight className="w-3 h-3 text-text-muted" />
                  <button
                    type="button"
                    onClick={() => files.setPath(segments.slice(0, i + 1).join("/"))}
                    className={cn(
                      "px-1 truncate max-w-40",
                      i === segments.length - 1
                        ? "text-text-primary"
                        : "text-accent hover:underline",
                    )}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={files.refresh} title="Refresh">
              <RefreshCw className={cn("w-3.5 h-3.5", files.loading && "animate-spin")} />
            </Button>
            {canWrite && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openNameDialog({ kind: "mkdir" })}
                  title="New folder"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => uploadRef.current?.click()}
                  disabled={!!files.upload}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload
                </Button>
                <input
                  ref={uploadRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void files.uploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </>
            )}
          </div>
        </div>

        {files.upload && (
          <div className="mb-3 space-y-1">
            <p className="text-xs text-text-secondary truncate">
              Uploading {files.upload.name}… {Math.round(files.upload.progress * 100)}%
            </p>
            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${Math.round(files.upload.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {(files.transferError || files.mutationError) && (
          <p className="text-xs text-danger mb-3">
            {files.transferError ?? files.mutationError}
          </p>
        )}

        {/* Listing */}
        {files.loading ? (
          <p className="text-sm text-text-muted py-6 text-center">Loading files…</p>
        ) : files.listError ? (
          <p className="text-sm text-danger py-6 text-center">{files.listError}</p>
        ) : files.entries.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">
            This folder is empty.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {files.entries.map((entry) => {
              const target = joinPath(files.path, entry.name);
              const Icon = ENTRY_ICON[entry.type];
              return (
                <div
                  key={entry.name}
                  className="flex items-center gap-3 px-2 py-1.5 hover:bg-surface-2 rounded-lg transition-colors group"
                >
                  <button
                    type="button"
                    onClick={() => openEntry(entry)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    <Icon
                      className={cn(
                        "w-3.5 h-3.5 shrink-0",
                        entry.type === "directory" ? "text-accent" : "text-text-muted",
                      )}
                    />
                    <span className="text-sm truncate">{entry.name}</span>
                  </button>
                  <span className="text-xs text-text-muted w-16 text-right shrink-0 hidden sm:block">
                    {entry.type === "directory" ? "—" : formatBytes(entry.size)}
                  </span>
                  <span className="text-xs text-text-muted w-16 text-right shrink-0 hidden sm:block">
                    {timeAgo(entry.modifiedAt)}
                  </span>
                  <div className="flex gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void files.download(target, entry.type === "directory")}
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                    {canWrite && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            openNameDialog({ kind: "rename", target, current: entry.name })
                          }
                          title="Rename"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(target)}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-danger" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {files.truncated && (
          <p className="text-xs text-text-muted mt-2">
            Showing the first entries only — this folder is very large.
          </p>
        )}
      </Card>

      {files.editing && (
        <FileEditor
          key={`${files.volume}:${files.editing}`}
          gameServerId={server.id}
          volume={files.volume}
          path={files.editing}
          canWrite={canWrite}
          onClose={() => files.setEditing(null)}
        />
      )}

      <Modal
        open={!!nameDialog}
        onClose={() => setNameDialog(null)}
        title={nameDialog?.kind === "rename" ? "Rename" : "New folder"}
      >
        <form onSubmit={submitName} className="space-y-4">
          <Input
            label="Name"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            maxLength={255}
            autoFocus
            autoComplete="off"
          />
          {files.mutationError && (
            <p className="text-xs text-danger">{files.mutationError}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setNameDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={files.mutating || !nameValue.trim()}>
              {nameDialog?.kind === "rename" ? "Rename" : "Create folder"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete"
        description={`Permanently delete "${deleteTarget}"? Folders are deleted with everything inside them. This cannot be undone.`}
        confirmText="Delete"
        isPending={files.mutating}
      />
    </div>
  );
});
