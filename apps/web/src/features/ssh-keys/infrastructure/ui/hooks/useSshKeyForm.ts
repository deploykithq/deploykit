import { useState } from "react";

import { trpc } from "@lib/trpc";

import {
  downloadText,
  slugify,
} from "@ssh-keys/infrastructure/ui/utils/ssh-keys.utils";

import type { SshKeyTypeT } from "@ssh-keys/infrastructure/ui/interfaces/ssh-keys.interfaces";

export const useSshKeyForm = (onCreated: () => void) => {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [privateKey, setPrivateKey] = useState<string>("");
  const [publicKey, setPublicKey] = useState<string>("");

  const resetForm = () => {
    setName("");
    setDescription("");
    setPrivateKey("");
    setPublicKey("");
  };

  const generateMutation = trpc.sshKey.generate.useMutation({
    onSuccess: (key) => {
      setPrivateKey(key.privateKey);
      setPublicKey(key.publicKey);
    },
  });

  const createMutation = trpc.sshKey.create.useMutation({
    onSuccess: () => {
      resetForm(); // wipes the private key from component state
      onCreated();
    },
  });

  const handleGenerate = (type: SshKeyTypeT) => {
    generateMutation.mutate({ type, comment: name.trim() || undefined });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      description: description.trim() || undefined,
      privateKey,
    });
  };

  const filename = slugify(name);

  return {
    name,
    setName,
    description,
    setDescription,
    privateKey,
    setPrivateKey,
    publicKey,
    setPublicKey,
    generating: generateMutation.isPending,
    creating: createMutation.isPending,
    error: createMutation.error ?? generateMutation.error,
    handleGenerate,
    handleSubmit,
    downloadPrivate: () => downloadText(filename, privateKey),
    downloadPublic: () => downloadText(`${filename}.pub`, publicKey),
    resetForm,
  };
};
