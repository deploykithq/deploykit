import { createHash } from "crypto";
import { and, eq, isNull } from "drizzle-orm";

import { sessions } from "../db/schema/index";
import {
  refreshTokenStore,
  revokedSessionStore,
  REFRESH_TOKEN_TTL_SEC,
} from "./redis";
import { disconnectSession } from "./socket";

import type { DB } from "../db/index";

/**
 * Session bookkeeping. A session is a refresh token with metadata attached:
 * the Redis whitelist stays the fast path for validation, while the `sessions`
 * table is the source of truth admins can list, filter and revoke.
 *
 * The raw refresh token is never persisted — rows are keyed by its sha256, and
 * the Redis key uses that same hash so a row alone is enough to evict the token.
 */

const USER_AGENT_MAX = 512;

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const expiryFromNow = (): Date =>
  new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);

const truncateUserAgent = (userAgent: string | null): string | null =>
  userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null;

interface CreateSessionOptsI {
  db: DB;
  sessionId: string;
  userId: string;
  token: string;
  ip: string;
  userAgent: string | null;
}

/**
 * Records a brand new session (login / register) in both Redis and the DB.
 * The id is supplied by the caller because it is also embedded in the access
 * token (`sid`), which has to be minted before the row exists.
 */
const createSession = async ({
  db,
  sessionId,
  userId,
  token,
  ip,
  userAgent,
}: CreateSessionOptsI): Promise<void> => {
  const tokenHash = hashToken(token);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash,
    ip,
    userAgent: truncateUserAgent(userAgent),
    expiresAt: expiryFromNow(),
  });

  await refreshTokenStore.set(tokenHash, userId);
};

interface RotateSessionOptsI {
  db: DB;
  oldToken: string;
  newToken: string;
  ip: string;
  userAgent: string | null;
}

/**
 * Moves an existing session onto a rotated refresh token. Updates the row in
 * place rather than inserting: access tokens live 15 minutes, so a row per
 * refresh would add ~96 rows per user per day.
 *
 * Returns the updated row, or null when the session is unknown or already
 * revoked — which lets the caller reject the refresh even if the Redis key
 * somehow survived. The row id is what the new access token is stamped with.
 */
const rotateSession = async ({
  db,
  oldToken,
  newToken,
  ip,
  userAgent,
}: RotateSessionOptsI) => {
  const oldHash = hashToken(oldToken);
  const newHash = hashToken(newToken);

  const [updated] = await db
    .update(sessions)
    .set({
      tokenHash: newHash,
      ip,
      userAgent: truncateUserAgent(userAgent),
      lastUsedAt: new Date(),
      expiresAt: expiryFromNow(),
    })
    .where(and(eq(sessions.tokenHash, oldHash), isNull(sessions.revokedAt)))
    .returning();

  if (!updated) return null;

  await refreshTokenStore.del(oldHash);
  await refreshTokenStore.set(newHash, updated.userId);
  return updated;
};

/**
 * Cuts a session off everywhere it can still be used: the access token
 * revocation list (checked on every request) and any live socket. The refresh
 * token is already dead by the time this runs, since its Redis key is gone.
 */
const enforceRevocation = async (sessionId: string): Promise<void> => {
  try {
    await revokedSessionStore.mark(sessionId);
  } catch (err) {
    console.error("[sessions] Failed to mark session as revoked:", err);
  }
  disconnectSession(sessionId);
};

/** Ends the session behind a refresh token (logout). Idempotent. */
const revokeSessionByToken = async (db: DB, token: string): Promise<void> => {
  const tokenHash = hashToken(token);
  const now = new Date();

  const [revoked] = await db
    .update(sessions)
    .set({ revokedAt: now, expiresAt: now })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .returning();

  await refreshTokenStore.del(tokenHash);
  if (revoked) await enforceRevocation(revoked.id);
};

/**
 * Ends a session by row id (admin revoke). Returns the revoked row, or null if
 * no such session exists. Already-revoked sessions resolve to the existing row
 * so the caller can stay idempotent.
 */
const revokeSessionById = async (db: DB, id: string) => {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, id),
  });
  if (!session) return null;

  const now = new Date();
  if (!session.revokedAt) {
    await db
      .update(sessions)
      .set({ revokedAt: now, expiresAt: now })
      .where(eq(sessions.id, id));
  }

  // The DB row is authoritative — a Redis hiccup must not fail the revoke,
  // since auth.refresh re-checks the row anyway.
  try {
    await refreshTokenStore.del(session.tokenHash);
  } catch (err) {
    console.error("[sessions] Failed to evict token from Redis:", err);
  }

  await enforceRevocation(session.id);

  return { ...session, revokedAt: session.revokedAt ?? now, expiresAt: now };
};

export {
  hashToken,
  createSession,
  rotateSession,
  revokeSessionByToken,
  revokeSessionById,
};
