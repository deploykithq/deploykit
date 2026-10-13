import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import type { inferRouterClient } from "@trpc/client";
import type { AppRouter } from "../../../api/src/routers/index";
import { useAuthStore, isTokenExpired } from "./auth";

export const trpc = createTRPCReact<AppRouter>();

// A single shared promise while a refresh is in flight.
// All concurrent callers await the same promise instead of racing.
let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(refreshToken: string): Promise<string | null> {
  const { setAuth, clearTokens } = useAuthStore.getState();

  try {
    const res = await fetch("/trpc/auth.refresh?batch=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "0": { json: { refreshToken } } }),
    });

    if (!res.ok) throw new Error("Refresh request failed");

    const data = await res.json();
    const result = data?.[0]?.result?.data?.json;

    if (result?.accessToken && result?.refreshToken) {
      setAuth(result.user, result.accessToken, result.refreshToken);
      return result.accessToken;
    }
  } catch {
    // Network error or server error — fall through to logout
  }

  clearTokens();
  return null;
}

// Proactively refreshes before a request if the access token is
// expired (or about to expire in 30s). Deduplicates concurrent calls.
async function getAccessToken(): Promise<string | null> {
  const { accessToken, refreshToken } = useAuthStore.getState();

  // Access token is fresh — use it directly
  if (accessToken && !isTokenExpired(accessToken)) {
    return accessToken;
  }

  // No refresh token — user is logged out
  if (!refreshToken) {
    if (accessToken) useAuthStore.getState().clearTokens();
    return null;
  }

  // Deduplicate: reuse in-flight promise if one is already running
  if (!refreshPromise) {
    refreshPromise = doRefresh(refreshToken).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

// Injects the (refreshed if needed) access token into every request.
// If we still get 401 after a valid token (e.g. server-side revocation),
// clear local state so the user is redirected to login.
async function fetchWithAuth(
  url: RequestInfo | URL,
  opts?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken();

  const base: Record<string, string> = {};
  if (opts?.headers) {
    if (opts.headers instanceof Headers) {
      opts.headers.forEach((v, k) => {
        base[k] = v;
      });
    } else if (Array.isArray(opts.headers)) {
      opts.headers.forEach(([k, v]) => {
        base[k] = v;
      });
    } else {
      Object.assign(base, opts.headers);
    }
  }
  if (token) base.authorization = `Bearer ${token}`;

  const headers = base;

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    // Token was rejected server-side (revoked, tampered, etc.)
    useAuthStore.getState().clearTokens();
  }

  return res;
}

function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/trpc",
        fetch: fetchWithAuth,
        headers: () => ({}), // headers are injected by fetchWithAuth
      }),
    ],
  });
}

/**
 * The router as a plain client. Only used for types: features derive a
 * procedure's output with `Awaited<ReturnType<AppRouterClientT["x"]["y"]["query"]>>`
 * instead of restating the API's shapes by hand.
 */
type AppRouterClientT = inferRouterClient<AppRouter>;

export { createTRPCClient, getAccessToken };
export type { AppRouterClientT };
