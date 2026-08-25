import { useState } from "react";

import { trpc } from "@lib/trpc";

export const useAddServerForm = (onCreated: () => void) => {
  const [name, setName] = useState<string>("");
  const [host, setHost] = useState<string>("");
  const [port, setPort] = useState<string>("22");
  const [username, setUsername] = useState<string>("root");
  const [sshKeyId, setSshKeyId] = useState<string>("");

  const { data: sshKeys, isLoading: loadingKeys } = trpc.sshKey.list.useQuery();

  const resetForm = () => {
    setName("");
    setHost("");
    setPort("22");
    setUsername("root");
    setSshKeyId("");
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
      sshKeyId,
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
    sshKeyId,
    setSshKeyId,
    sshKeys,
    loadingKeys,
    creating: createMutation.isPending,
    error: createMutation.error,
    handleSubmit,
  };
};
