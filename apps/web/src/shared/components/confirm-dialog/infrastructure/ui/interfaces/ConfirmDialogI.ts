type ConfirmDialogVariantT = "danger" | "primary";

interface ConfirmDialogPropsI {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  /** Texto mientras la acción está en curso. Por defecto asume un borrado. */
  pendingText?: string;
  variant?: ConfirmDialogVariantT;
  isPending?: boolean;
}

export type { ConfirmDialogVariantT, ConfirmDialogPropsI };
