import { useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { useAuthStore } from "@lib/auth";
import { useServiceUpdates } from "@lib/socket";
import { trpc } from "@lib/trpc";

/**
 * Concerns de runtime del layout protegido: suscripción a updates de servicios,
 * expulsión al login cuando no hay tokens y rehidratación del usuario tras un
 * refresco de página (los tokens sobreviven en localStorage, el usuario no).
 */
export const useAppLayout = () => {
  useServiceUpdates();

  const navigate = useNavigate();
  const location = useLocation();

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
};
