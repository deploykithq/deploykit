import type { ButtonSizeT, ButtonVariantT } from "../interfaces/ButtonI";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50";

const BUTTON_SIZES: Record<ButtonSizeT, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

const BUTTON_VARIANTS: Record<ButtonVariantT, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary:
    "bg-surface-2 text-text-primary border border-border hover:bg-surface-3",
  danger: "bg-danger/10 text-danger hover:bg-danger/20",
  ghost: "text-text-secondary hover:text-text-primary hover:bg-surface-2",
};

export { BUTTON_BASE, BUTTON_SIZES, BUTTON_VARIANTS };
