import { memo } from "react";
import { AlertTriangle, Github } from "lucide-react";

import { Select } from "@shared/components/select";
import { Combobox } from "@shared/components/combobox";

import type { useRepositoryPicker } from "@github/infrastructure/ui/hooks/useRepositoryPicker";

interface RepositoryPickerPropsI {
  picker: ReturnType<typeof useRepositoryPicker>;
  branch: string;
  onBranchChange: (branch: string) => void;
}

export const RepositoryPicker: React.FC<RepositoryPickerPropsI> = memo(
  function RepositoryPicker({ picker, branch, onBranchChange }) {
    const {
      installationId,
      setInstallationId,
      repoId,
      setRepoId,
      installations,
      repositories,
      repositoriesLoading,
      repositoriesTruncated,
      repositoriesError,
      branches,
      branchesLoading,
    } = picker;

    if (installations.length === 0) {
      return (
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <p className="text-xs text-text-muted flex items-start gap-1.5">
            <Github className="w-3.5 h-3.5 shrink-0 mt-px" />
            The GitHub App is not installed on any account yet. An admin can
            install it from Settings.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {installations.length > 1 && (
          <Select
            label="Account"
            value={installationId}
            onChange={(e) => setInstallationId(e.target.value)}
            options={installations.map((i) => ({
              value: i.id,
              label: i.accountLogin,
            }))}
          />
        )}

        <Combobox
          label="Repository"
          value={repoId}
          onChange={(value) => {
            setRepoId(value);
            const picked = repositories.find((r) => String(r.id) === value);
            // Follow the repository's own default branch on first pick.
            if (picked) onBranchChange(picked.defaultBranch);
          }}
          options={repositories.map((r) => ({
            value: String(r.id),
            label: r.fullName,
            hint: r.private ? "private" : undefined,
          }))}
          loading={repositoriesLoading}
          placeholder="Search repositories..."
          emptyLabel={
            repositoriesLoading ? "Loading..." : "No repositories match"
          }
          note={
            repositoriesTruncated
              ? "Showing the first few hundred repositories — type to narrow the list."
              : undefined
          }
        />

        {repositoriesError && (
          <p className="text-xs text-danger flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {repositoriesError}
          </p>
        )}

        <Combobox
          label="Branch"
          value={branch}
          onChange={onBranchChange}
          options={branches.map((b) => ({ value: b, label: b }))}
          loading={branchesLoading}
          disabled={!repoId}
          placeholder={repoId ? "Search branches..." : "Pick a repository first"}
          emptyLabel={branchesLoading ? "Loading..." : "No branches match"}
        />
      </div>
    );
  },
);
