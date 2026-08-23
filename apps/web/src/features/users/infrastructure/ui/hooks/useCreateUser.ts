import { useState } from "react";

import { trpc } from "@lib/trpc";

import type { RoleValueT } from "@users/infrastructure/ui/interfaces/users.interfaces";

const DEFAULT_ROLE: RoleValueT = "viewer";

export const useCreateUser = (onCreated: () => void) => {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [role, setRole] = useState<RoleValueT>(DEFAULT_ROLE);

  const createMutation = trpc.user.create.useMutation({
    onSuccess: () => {
      resetForm();
      onCreated();
    },
  });

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setRole(DEFAULT_ROLE);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ email, password, role: role as any });
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    role,
    setRole,
    isPending: createMutation.isPending,
    error: createMutation.error?.message ?? null,
    handleSubmit,
  };
};
