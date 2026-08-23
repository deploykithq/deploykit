interface ModalPropsI {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export type { ModalPropsI };
