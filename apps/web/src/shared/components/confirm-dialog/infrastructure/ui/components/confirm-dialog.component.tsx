import { memo } from "react";

import { Button } from "@shared/components/button";

import type { ConfirmDialogPropsI } from "../interfaces/ConfirmDialogI";

export const ConfirmDialog: React.FC<ConfirmDialogPropsI> = memo(
  function ConfirmDialog({
    open,
    onClose,
    onConfirm,
    title,
    description,
    confirmText = "Delete",
    variant = "danger",
    isPending,
  }) {
    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="relative bg-surface-1 border border-border rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-sm shadow-2xl">
          <h2 className="text-lg font-semibold mb-2">{title}</h2>
          <p className="text-sm text-text-secondary mb-6">{description}</p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant={variant}
              size="sm"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : confirmText}
            </Button>
          </div>
        </div>
      </div>
    );
  },
);
