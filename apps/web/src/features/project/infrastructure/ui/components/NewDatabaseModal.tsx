import { memo } from "react";
import type { DatabaseType } from "@deploykit/shared";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Select } from "@shared/components/select";

import { ServerSelector } from "@project/infrastructure/ui/components/ServerSelector";

import { useNewDatabaseForm } from "@project/infrastructure/ui/hooks/useNewDatabaseForm";

import { DB_TYPE_OPTIONS } from "@project/infrastructure/ui/constants/project.constants";

interface NewDatabaseModalPropsI {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: () => void;
}

export const NewDatabaseModal: React.FC<NewDatabaseModalPropsI> = memo(
  function NewDatabaseModal({ open, onClose, projectId, onCreated }) {
    const {
      name,
      setName,
      type,
      setType,
      serverId,
      setServerId,
      replicaSet,
      setReplicaSet,
      creating,
      handleSubmit,
    } = useNewDatabaseForm(projectId, onCreated);

    return (
      <Modal open={open} onClose={onClose} title="New Database">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-database"
            required
          />
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as DatabaseType)}
            options={DB_TYPE_OPTIONS}
          />
          <ServerSelector value={serverId} onChange={setServerId} />
          {type === "mongodb" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={replicaSet}
                onChange={(e) => setReplicaSet(e.target.checked)}
                className="rounded border-border bg-surface-2 text-accent focus:ring-accent"
              />
              <span className="text-sm">Enable Replica Set</span>
              <span className="text-xs text-text-muted">
                (required for transactions &amp; change streams)
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create Database"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
