import { useEffect, useState } from "react";

import { trpc } from "@lib/trpc";

/**
 * Pick an installation, then a repository, then a branch.
 *
 * Only the installation and the repository's numeric id are ever submitted:
 * the server resolves the URL and the full name itself, and refuses a
 * repository the installation cannot reach.
 */
export const useRepositoryPicker = (projectId: string, enabled: boolean) => {
  const [installationId, setInstallationId] = useState<string>("");
  const [repoId, setRepoId] = useState<string>("");

  const installations = trpc.github.listInstallations.useQuery(
    { projectId },
    { enabled },
  );

  // Default to the only installation there is, which is the common case.
  useEffect(() => {
    if (!installationId && installations.data?.length === 1) {
      setInstallationId(installations.data[0]!.id);
    }
  }, [installations.data, installationId]);

  const repositories = trpc.github.listRepositories.useQuery(
    { projectId, installationId },
    { enabled: enabled && !!installationId },
  );

  const repo = repositories.data?.repos.find((r) => String(r.id) === repoId);

  const branches = trpc.github.listBranches.useQuery(
    { projectId, installationId, repoFullName: repo?.fullName ?? "" },
    { enabled: enabled && !!installationId && !!repo },
  );

  // A repository from a previous installation is not a valid choice any more.
  useEffect(() => {
    setRepoId("");
  }, [installationId]);

  return {
    installationId,
    setInstallationId,
    repoId,
    setRepoId,
    repo,
    installations: installations.data ?? [],
    installationsLoading: installations.isLoading,
    repositories: repositories.data?.repos ?? [],
    repositoriesLoading: repositories.isFetching,
    repositoriesTruncated: repositories.data?.truncated ?? false,
    repositoriesError: repositories.error?.message ?? null,
    branches: branches.data ?? [],
    branchesLoading: branches.isFetching,
  };
};
