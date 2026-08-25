type SshKeyTypeT = "rsa" | "ed25519";

interface SshKeyServerI {
  id: string;
  name: string;
}

interface SshKeyI {
  id: string;
  name: string;
  description: string | null;
  type: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string | Date;
  servers: SshKeyServerI[];
}

interface DeleteSshKeyTargetI {
  id: string;
  name: string;
}

interface SshKeyModalPropsI {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface SshKeyRowPropsI {
  sshKey: SshKeyI;
  onDelete: () => void;
}

export type {
  SshKeyTypeT,
  SshKeyServerI,
  SshKeyI,
  DeleteSshKeyTargetI,
  SshKeyModalPropsI,
  SshKeyRowPropsI,
};
