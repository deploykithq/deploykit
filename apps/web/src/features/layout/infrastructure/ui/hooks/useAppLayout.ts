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

  // Sólo hace falta rehidratar cuando hay tokens pero no usuario en memoria.
  const needsRehydration = !user && !!(accessToken || refreshToken);

  const { data, error } = trpc.auth.me.useQuery(undefined, {
    enabled: needsRehydration,
    retry: false,
  });

  useEffect(() => {
    // La caché de React Query sobrevive al fin de sesión: con la query
    // deshabilitada, `data`/`error` son los que dejó la sesión ANTERIOR.
    // Reaccionar a ese error borraría los tokens recién emitidos por el login
    // y devolvería al usuario a /login en bucle hasta recargar la página.
    if (!needsRehydration) return;

    if (data && accessToken && refreshToken) {
      useAuthStore.getState().setAuth(data as any, accessToken, refreshToken);
    } else if (error) {
      useAuthStore.getState().clearTokens();
    }
  }, [data, accessToken, refreshToken, error, needsRehydration]);
};
