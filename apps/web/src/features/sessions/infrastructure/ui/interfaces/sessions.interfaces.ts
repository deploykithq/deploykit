type SessionStatusFilterT = "all" | "active" | "expired";

type SessionStatusT = "active" | "expired" | "revoked";

interface FiltersI {
  status: SessionStatusFilterT;
  userId: string;
}

interface SessionEntryI {
  id: string;
  userId: string;
  userEmail: string;
  userRole: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string | Date;
  lastUsedAt: string | Date;
  expiresAt: string | Date;
  revokedAt: string | Date | null;
  status: SessionStatusT;
}

export type {
  FiltersI,
  SessionEntryI,
  SessionStatusT,
  SessionStatusFilterT,
};
