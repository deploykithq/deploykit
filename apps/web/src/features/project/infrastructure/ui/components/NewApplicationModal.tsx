import { memo } from "react";
import type { SourceType } from "@deploykit/shared";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Select } from "@shared/components/select";

import { ServerSelector } from "@project/infrastructure/ui/components/ServerSelector";

import { useNewApplicationForm } from "@project/infrastructure/ui/hooks/useNewApplicationForm";

import {
  BUILD_TYPE_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from "@project/infrastructure/ui/constants/project.constants";

import type { BuildTypeT } from "@project/infrastructure/ui/interfaces/project.interfaces";

interface NewApplicationModalPropsI {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: () => void;
}

export const NewApplicationModal: React.FC<NewApplicationModalPropsI> = memo(
  function NewApplicationModal({ open, onClose, projectId, onCreated }) {
    const {
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
      creating,
      isGitSource,
      handleSubmit,
    } = useNewApplicationForm(projectId, onCreated);

    return (
      <Modal open={open} onClose={onClose} title="New Application">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
            required
          />
          <Select
            label="Source"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as SourceType)}
            options={SOURCE_TYPE_OPTIONS}
          />
          {isGitSource && (
            <>
              <Input
                label="Repository URL"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo"
              />
              <Input
                label="Branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
              />
              <Input
                label="Access Token"
                value={sourceToken}
                onChange={(e) => setSourceToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
              />
              <Input
                label="Root Directory"
                value={rootDirectory}
                onChange={(e) => setRootDirectory(e.target.value)}
                placeholder="apps/web"
              />
              <p className="text-[11px] text-text-muted -mt-2">
                Subdirectory where the app lives. Leave empty if it's at the
                repo root.
              </p>
            </>
          )}
          <Select
            label="Build Type"
            value={buildType}
            onChange={(e) => setBuildType(e.target.value as BuildTypeT)}
            options={BUILD_TYPE_OPTIONS}
          />
          <Input
            label="Port"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="3000"
          />
          <ServerSelector value={serverId} onChange={setServerId} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create Application"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
