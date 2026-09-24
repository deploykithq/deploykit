import { useState } from "react";
import type { SourceType } from "@deploykit/shared";

import { trpc } from "@lib/trpc";

import { useRepositoryPicker } from "@github/infrastructure/ui/hooks/useRepositoryPicker";

import type { BuildTypeT } from "@project/infrastructure/ui/interfaces/project.interfaces";

/** How the repository is identified: through the App, or by URL and token. */
type SourceModeT = "github_app" | "url";

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
  const [sourceMode, setSourceMode] = useState<SourceModeT>("github_app");

  const isGitSource = sourceType !== "docker_image";

  const githubStatus = trpc.github.status.useQuery();
  const appConfigured = githubStatus.data?.configured ?? false;
  // The picker only makes sense for a GitHub source, and only once an App
  // exists. Otherwise the form is byte for byte what it always was.
  const usePicker = appConfigured && isGitSource && sourceMode === "github_app";

  const picker = useRepositoryPicker(projectId, usePicker);

  const resetForm = () => {
    setName("");
    setRepoUrl("");
    setRootDirectory("");
    setSourceToken("");
    setServerId(null);
    picker.setRepoId("");
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
    const connected = usePicker && !!picker.repoId;

    createMutation.mutate({
      projectId,
      name,
      sourceType,
      // The server derives the URL from the installation and repo id, so it
      // is deliberately not sent when the App is doing the connecting.
      repositoryUrl: connected ? undefined : repoUrl || undefined,
      branch,
      sourceToken: connected ? undefined : sourceToken || undefined,
      ...(connected && {
        githubInstallationId: picker.installationId,
        githubRepoId: Number(picker.repoId),
      }),
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
    isGitSource,
    appConfigured,
    sourceMode,
    setSourceMode,
    usePicker,
    picker,
    handleSubmit,
  };
};
