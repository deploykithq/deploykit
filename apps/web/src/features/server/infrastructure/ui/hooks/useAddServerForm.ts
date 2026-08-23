import { useState } from "react";

import { trpc } from "@lib/trpc";

import type { SshKeyMethodT } from "@server/infrastructure/ui/interfaces/server.interfaces";

export const useAddServerForm = (onCreated: () => void) => {
  const [name, setName] = useState<string>("");
  const [host, setHost] = useState<string>("");
  const [port, setPort] = useState<string>("22");
  const [username, setUsername] = useState<string>("root");
  const [keyMethod, setKeyMethod] = useState<SshKeyMethodT>("paste");
  const [sshKeyContent, setSshKeyContent] = useState<string>("");
  const [sshKeyPath, setSshKeyPath] = useState<string>("");

  const resetForm = () => {
    setName("");
    setHost("");
    setPort("22");
    setUsername("root");
    setSshKeyContent("");
    setSshKeyPath("");
  };

  const createMutation = trpc.server.create.useMutation({
    onSuccess: () => {
      resetForm();
      onCreated();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      host,
      port: parseInt(port),
      username,
      sshKeyContent:
        keyMethod === "paste" && sshKeyContent ? sshKeyContent : undefined,
      sshKeyPath: keyMethod === "path" && sshKeyPath ? sshKeyPath : undefined,
    });
  };

  return {
    name,
    setName,
    host,
    setHost,
    port,
    setPort,
    username,
    setUsername,
    keyMethod,
    setKeyMethod,
    sshKeyContent,
    setSshKeyContent,
    sshKeyPath,
    setSshKeyPath,
    creating: createMutation.isPending,
    error: createMutation.error,
    handleSubmit,
  };
};
