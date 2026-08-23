import { memo } from "react";
import { AlertTriangle } from "lucide-react";

import { useCreateUser } from "@users/infrastructure/ui/hooks/useCreateUser";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";
import { Select } from "@shared/components/select";

import {
  ROLE_OPTIONS,
  ROLE_DESCRIPTIONS,
} from "@users/infrastructure/ui/constants/users.constants";

interface CreateUserModalPropsI {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export const CreateUserModal: React.FC<CreateUserModalPropsI> = memo(
  function CreateUserModal({ open, onClose, onCreated }) {
    const {
      email,
      setEmail,
      password,
      setPassword,
      role,
      setRole,
      isPending,
      error,
      handleSubmit,
    } = useCreateUser(onCreated);

    return (
      <Modal open={open} onClose={onClose} title="Create User">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            minLength={8}
            required
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
            options={[...ROLE_OPTIONS]}
          />
          <div className="p-3 rounded-lg bg-surface-2 border border-border">
            <p className="text-xs text-text-muted">{ROLE_DESCRIPTIONS[role]}</p>
          </div>

          {error && (
            <p className="text-xs text-danger flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" />
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create User"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
