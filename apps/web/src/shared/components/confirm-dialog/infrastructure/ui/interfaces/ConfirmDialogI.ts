type ConfirmDialogVariantT = "danger" | "primary";

interface ConfirmDialogPropsI {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  variant?: ConfirmDialogVariantT;
  isPending?: boolean;
}

export type { ConfirmDialogVariantT, ConfirmDialogPropsI };
