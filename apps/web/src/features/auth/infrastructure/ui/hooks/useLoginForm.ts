import { useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

export const useLoginForm = () => {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");

  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: hasUsers, isLoading: checkingUsers } =
    trpc.auth.hasUsers.useQuery();

  const isRegister = hasUsers === false;

  const handleAuthSuccess = useCallback(
    (data: { user: any; accessToken: string; refreshToken: string }) => {
      // A new session must start with an empty cache. Anything the previous
      // session left behind (notably a failed auth.me) would otherwise be read
      // back by the app layout and mistaken for the *current* session state.
      queryClient.removeQueries();
      setAuth(data.user, data.accessToken, data.refreshToken);
      // Navigate to dashboard — this triggers the router to re-evaluate guards
      navigate({ to: "/" });
    },
    [queryClient, setAuth, navigate],
  );

  const handleAuthError = useCallback(
    (err: { message: string }) => setError(err.message),
    [],
  );

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: handleAuthSuccess,
    onError: handleAuthError,
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: handleAuthSuccess,
    onError: handleAuthError,
  });

  const isPending = loginMutation.isPending || registerMutation.isPending;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      const credentials = { email, password };

      if (isRegister) {
        registerMutation.mutate(credentials);
      } else {
        loginMutation.mutate(credentials);
      }
    },
    [email, password, isRegister, loginMutation, registerMutation],
  );

  return {
    email,
    setEmail,
    password,
    setPassword,
    error,
    isRegister,
    isPending,
    checkingUsers,
    hasUsers,
    handleSubmit,
  };
};
