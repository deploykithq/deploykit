type SshKeyMethodT = "paste" | "path";

interface DeleteServerTargetI {
  id: string;
  name: string;
}

interface PruneResultI {
  serverName: string;
  imagesRemoved: number;
  bytesFreed: number;
  errors: string[];
}

interface ImageCleanupPanelPropsI {
  open: boolean;
  onClose: () => void;
}

interface AddServerModalPropsI {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export type {
  SshKeyMethodT,
  DeleteServerTargetI,
  PruneResultI,
  ImageCleanupPanelPropsI,
  AddServerModalPropsI,
};
