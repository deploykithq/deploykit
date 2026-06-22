import { create } from "zustand";

interface UserI {
  id: string;
  email: string;
  role: "admin" | "operator" | "viewer";
}

interface AuthStateI {
  user: UserI | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: UserI, accessToken: string, refreshToken: string) => void;
  clearTokens: () => void;
  logout: () => void;
  isAuthenticated: () => boolean;
  isAdmin: () => boolean;
  canWrite: () => boolean;
}

// Decodes the exp claim client-side (no secret needed — we're just reading
// the payload, not verifying the signature).
export const isTokenExpired = (token: string, bufferMs = 30_000): boolean => {
  try {
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(
      atob(payloadB64!.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload.exp * 1000 < Date.now() + bufferMs;
  } catch {
    return true;
  }
};

export const useAuthStore = create<AuthStateI>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem("accessToken"),
  refreshToken: localStorage.getItem("refreshToken"),

  setAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    set({ user, accessToken, refreshToken });
    // Re-handshake the socket with the new token (dynamic import avoids
    // a static auth → socket → trpc → auth module cycle)
    void import("./socket").then((m) => m.reconnectSocket());
  },

  // Clears local state only — used after server-side revocation
  clearTokens: () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    set({ user: null, accessToken: null, refreshToken: null });
  },

  // Full logout: server revocation happens in useLogout hook before calling this
  logout: () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    set({ user: null, accessToken: null, refreshToken: null });
    void import("./socket").then((m) => m.reconnectSocket());
  },

  // Authenticated if we have any token — the tRPC client handles proactive refresh
  // when the access token is expired but a refresh token still exists.
  isAuthenticated: () => {
    const { accessToken, refreshToken } = get();
    return !!(accessToken || refreshToken);
  },

  isAdmin: () => get().user?.role === "admin",
  canWrite: () => {
    const role = get().user?.role;
    return role === "admin" || role === "operator";
  },
}));
