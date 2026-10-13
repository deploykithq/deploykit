import { memo } from "react";

import { Button } from "@shared/components/button";
import { Modal } from "@shared/components/modal";

interface DeleteGameServerDialogPropsI {
  open: boolean;
  name: string;
  deleteData: boolean;
  onDeleteDataChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  error: string | null;
}

/**
 * Delete confirmation with the option to keep or destroy the world. A modal
 * rather than ConfirmDialog, which has no room for the checkbox.
 */
export const DeleteGameServerDialog: React.FC<DeleteGameServerDialogPropsI> = memo(
  function DeleteGameServerDialog({
    open,
    name,
    deleteData,
    onDeleteDataChange,
    onClose,
    onConfirm,
    isPending,
    error,
  }) {
    return (
      <Modal open={open} onClose={onClose} title="Delete game server">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            This removes "{name}" and its container. By default its world
            volumes and backups are kept on the host.
          </p>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(e) => onDeleteDataChange(e.target.checked)}
              className="mt-0.5 rounded border-border bg-surface-2 text-accent focus:ring-accent"
            />
            <span>
              Also delete world data and backups
              <span className="block text-xs text-danger">
                This cannot be undone.
              </span>
            </span>
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={onConfirm} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete game server"}
            </Button>
          </div>
        </div>
      </Modal>
    );
  },
);
