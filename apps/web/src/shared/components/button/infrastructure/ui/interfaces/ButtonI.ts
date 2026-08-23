type ButtonVariantT = "primary" | "secondary" | "danger" | "ghost";

type ButtonSizeT = "sm" | "md";

interface ButtonPropsI extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariantT;
  size?: ButtonSizeT;
}

export type { ButtonVariantT, ButtonSizeT, ButtonPropsI };
