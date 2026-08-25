import { memo } from "react";
import { KeyRound } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Select } from "@shared/components/select";

import { useAddServerForm } from "@server/infrastructure/ui/hooks/useAddServerForm";

import type { AddServerModalPropsI } from "@server/infrastructure/ui/interfaces/server.interfaces";

export const AddServerModal: React.FC<AddServerModalPropsI> = memo(
  function AddServerModal({ open, onClose, onCreated }) {
    const {
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
      creating,
      error,
      handleSubmit,
    } = useAddServerForm(onCreated);

    return (
      <Modal open={open} onClose={onClose} title="Add Remote Server">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Server Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="production-1"
            required
          />
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="col-span-2">
              <Input
                label="Host / IP"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100 or my-server.com"
                required
              />
            </div>
            <Input
              label="SSH Port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="22"
            />
          </div>
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="root"
          />

          {/* SSH key, picked from the catalogue */}
          {loadingKeys ? (
            <p className="text-xs text-text-muted">Loading SSH keys...</p>
          ) : !sshKeys?.length ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-2 border border-border">
              <KeyRound className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
              <p className="text-xs text-text-muted">
                No SSH keys yet. Create one on the{" "}
                <Link to="/ssh-keys" className="text-accent hover:underline">
                  SSH Keys
                </Link>{" "}
                page, add its public half to this server&apos;s{" "}
                <code>~/.ssh/authorized_keys</code>, then come back.
              </p>
            </div>
          ) : (
            <Select
              label="SSH Key"
              value={sshKeyId}
              onChange={(e) => setSshKeyId(e.target.value)}
              options={[
                { value: "", label: "Select a key..." },
                ...sshKeys.map((key) => ({
                  value: key.id,
                  label: `${key.name} (${key.type})`,
                })),
              ]}
              required
            />
          )}

          {error && <p className="text-xs text-danger">{error.message}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !sshKeyId}>
              {creating ? "Adding..." : "Add Server"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
