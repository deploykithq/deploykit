import { memo } from "react";

import { cn } from "@lib/utils";

import { BUTTON_BASE, BUTTON_SIZES, BUTTON_VARIANTS } from "../constants/styles";

import type { ButtonPropsI } from "../interfaces/ButtonI";

export const Button: React.FC<ButtonPropsI> = memo(function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        BUTTON_BASE,
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
});
