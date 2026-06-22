import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "@tanstack/react-router";

import { Layout } from "@layout/infrastructure/ui/components";
import { AlertToasts } from "@metrics/infrastructure/ui/components/AlertToasts";

import { useServiceUpdates } from "@lib/socket";
import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

export const AppLayout: React.FC = () => {
  useServiceUpdates();

  const navigate = useNavigate();
  const location = useLocation();

  // Rehydrate user on page refresh — tokens survive in localStorage but
  // the user object is lost. This fetches it once and populates the store.
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);

  useEffect(() => {
    if (!accessToken && !refreshToken) {
      navigate({ to: "/login", search: { redirect: location.pathname } });
    }
  }, [accessToken, refreshToken, navigate, location.pathname]);

  const { data, error } = trpc.auth.me.useQuery(undefined, {
    enabled: !user && !!(accessToken || refreshToken),
    retry: false,
  });

  useEffect(() => {
    if (data && accessToken && refreshToken) {
      useAuthStore.getState().setAuth(data as any, accessToken, refreshToken);
    } else if (error) {
      useAuthStore.getState().clearTokens();
    }
  }, [data, accessToken, refreshToken, error]);

  return (
    <Layout>
      <Outlet />
      <AlertToasts />
    </Layout>
  );
};
