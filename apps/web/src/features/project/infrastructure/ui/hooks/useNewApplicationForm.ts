import { useState } from "react";
import type { SourceType } from "@deploykit/shared";

import { trpc } from "@lib/trpc";

import type { BuildTypeT } from "@project/infrastructure/ui/interfaces/project.interfaces";

export const useNewApplicationForm = (
  projectId: string,
  onCreated: () => void,
) => {
  const [name, setName] = useState<string>("");
  const [sourceType, setSourceType] = useState<SourceType>("github");
  const [repoUrl, setRepoUrl] = useState<string>("");
  const [branch, setBranch] = useState<string>("main");
  const [buildType, setBuildType] = useState<BuildTypeT>("nixpacks");
  const [port, setPort] = useState<string>("3000");
  const [serverId, setServerId] = useState<string | null>(null);
  const [sourceToken, setSourceToken] = useState<string>("");
  const [rootDirectory, setRootDirectory] = useState<string>("");

  const resetForm = () => {
    setName("");
    setRepoUrl("");
    setRootDirectory("");
    setSourceToken("");
    setServerId(null);
  };

  const createMutation = trpc.application.create.useMutation({
    onSuccess: () => {
      onCreated();
      resetForm();
    },
    onError: (err) => alert(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      projectId,
      name,
      sourceType,
      repositoryUrl: repoUrl || undefined,
      branch,
      sourceToken: sourceToken || undefined,
      rootDirectory: rootDirectory || undefined,
      buildType,
      port: parseInt(port) || undefined,
      serverId: serverId ?? undefined,
    });
  };

  return {
    name,
    setName,
    sourceType,
    setSourceType,
    repoUrl,
    setRepoUrl,
    branch,
    setBranch,
    buildType,
    setBuildType,
    port,
    setPort,
    serverId,
    setServerId,
    sourceToken,
    setSourceToken,
    rootDirectory,
    setRootDirectory,
    creating: createMutation.isPending,
    isGitSource: sourceType !== "docker_image",
    handleSubmit,
  };
};
