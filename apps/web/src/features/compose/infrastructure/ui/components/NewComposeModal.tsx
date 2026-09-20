import { memo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";

import { ServerSelector } from "@project/infrastructure/ui/components/ServerSelector";

import { trpc } from "@lib/trpc";

import { COMPOSE_PLACEHOLDER } from "@compose/infrastructure/ui/constants/compose.constants";

import type { NewComposeModalPropsI } from "@compose/infrastructure/ui/interfaces/compose.interfaces";

export const NewComposeModal: React.FC<NewComposeModalPropsI> = memo(
  function NewComposeModal({ open, onClose, projectId }) {
    const navigate = useNavigate();
    const utils = trpc.useUtils();

    const [name, setName] = useState("");
    const [composeFile, setComposeFile] = useState(COMPOSE_PLACEHOLDER);
    const [serverId, setServerId] = useState<string | null>(null);

    const createMutation = trpc.compose.create.useMutation({
      onSuccess: (stack) => {
        utils.compose.list.invalidate();
        utils.project.byId.invalidate({ id: projectId });
        close();
        navigate({
          to: "/projects/$projectId/compose/$composeId",
          params: { projectId, composeId: stack.id },
        });
      },
    });

    const close = () => {
      setName("");
      setComposeFile(COMPOSE_PLACEHOLDER);
      setServerId(null);
      createMutation.reset();
      onClose();
    };

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      createMutation.mutate({
        projectId,
        name: name.trim(),
        composeFile,
        serverId: serverId ?? undefined,
      });
    };

    return (
      <Modal open={open} onClose={close} title="New Compose stack">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-stack"
            required
            autoFocus
          />
          <p className="text-[11px] text-text-muted -mt-2">
            Lowercase letters, numbers and hyphens. Becomes the Compose project
            name, so it prefixes every container, network and volume.
          </p>

          <div>
            <label className="block text-sm mb-1.5">docker-compose.yml</label>
            <textarea
              value={composeFile}
              onChange={(e) => setComposeFile(e.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full px-4 py-3 rounded-lg bg-surface-2 border border-border text-sm font-mono text-text-primary focus:outline-none focus:border-accent resize-y"
            />
            <p className="text-[11px] text-text-muted mt-1.5">
              Use <code>expose</code> rather than <code>ports</code> and skip{" "}
              <code>container_name</code>. Add domains after creating the stack;
              DeployKit injects the routing labels itself.
            </p>
          </div>

          <ServerSelector value={serverId} onChange={setServerId} />

          {createMutation.error && (
            <p className="text-xs text-danger">
              {createMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createMutation.isPending ||
                !name.trim() ||
                !composeFile.trim()
              }
            >
              {createMutation.isPending ? "Creating…" : "Create stack"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
