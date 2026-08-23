import { useState } from "react";
import type { DatabaseType } from "@deploykit/shared";

import { trpc } from "@lib/trpc";

export const useNewDatabaseForm = (
  projectId: string,
  onCreated: () => void,
) => {
  const [name, setName] = useState<string>("");
  const [type, setType] = useState<DatabaseType>("postgresql");
  const [serverId, setServerId] = useState<string | null>(null);
  const [replicaSet, setReplicaSet] = useState<boolean>(false);

  const createMutation = trpc.database.create.useMutation({
    onSuccess: (data) => {
      onCreated();
      setName("");
      setServerId(null);
      setReplicaSet(false);
      if (data.connectionString) {
        alert(
          `Database created!\n\nConnection string:\n${data.connectionString}`,
        );
      }
    },
    onError: (err) => alert(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      projectId,
      name,
      type,
      serverId: serverId ?? undefined,
      replicaSet: type === "mongodb" ? replicaSet : false,
    });
  };

  return {
    name,
    setName,
    type,
    setType,
    serverId,
    setServerId,
    replicaSet,
    setReplicaSet,
    creating: createMutation.isPending,
    handleSubmit,
  };
};
