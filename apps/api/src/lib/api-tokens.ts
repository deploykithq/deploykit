import { createHash, randomBytes } from "crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";

import { apiTokens } from "../db/schema/index";

import type { db as Db } from "../db/index";
import type { ApiTokenT, UserT } from "../db/schema/index";

/**
 * API tokens — long-lived credentials for non-browser clients.
 *
 * A token is 32 random bytes, so a plain SHA-256 is the right hash: there is
 * nothing to brute-force, and the lookup runs on every request (bcrypt would
 * add ~250 ms to each one for no gain).
 */

const API_TOKEN_PREFIX = "dk_";
const DISPLAY_PREFIX_LENGTH = 10;
const LAST_USED_RESOLUTION_MS = 60_000;

type ApiTokenScopeT = "read" | "write";

/** What a request authenticated with a token carries in its context. */
interface ApiTokenContextT {
  id: string;
  name: string;
  scope: ApiTokenScopeT;
}

const isApiToken = (raw: string): boolean => raw.startsWith(API_TOKEN_PREFIX);

const hashApiToken = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

const generateApiToken = (): { token: string; hash: string; prefix: string } => {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  };
};

const isExpired = (
  token: Pick<ApiTokenT, "expiresAt">,
  now: Date = new Date(),
): boolean => token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime();

/**
 * Whether a token may make this kind of call. A `read` token is limited to
 * queries; note that DeployKit's configuration exports are mutations on
 * purpose, so a `read` token cannot export secrets either.
 */
const tokenAllowsCall = (
  token: Pick<ApiTokenContextT, "scope"> | null,
  type: "query" | "mutation" | "subscription",
): boolean => token === null || token.scope === "write" || type === "query";

/**
 * Resolves a raw token to its user. Returns null for an unknown or expired
 * token — the caller continues unauthenticated, exactly as with a bad JWT.
 */
const resolveApiToken = async (
  db: typeof Db,
  raw: string,
): Promise<{ user: UserT; apiToken: ApiTokenContextT } | null> => {
  if (!isApiToken(raw)) return null;

  const row = await db.query.apiTokens.findFirst({
    where: eq(apiTokens.tokenHash, hashApiToken(raw)),
    with: { user: true },
  });
  if (!row || !row.user || isExpired(row)) return null;

  // Best effort, at most once a minute per token: this runs on every request.
  const now = new Date();
  void db
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiTokens.id, row.id),
        or(
          isNull(apiTokens.lastUsedAt),
          lt(apiTokens.lastUsedAt, new Date(now.getTime() - LAST_USED_RESOLUTION_MS)),
        ),
      ),
    )
    .catch(() => undefined);

  return {
    user: row.user,
    apiToken: { id: row.id, name: row.name, scope: row.scope as ApiTokenScopeT },
  };
};

export {
  API_TOKEN_PREFIX,
  isApiToken,
  hashApiToken,
  generateApiToken,
  isExpired,
  tokenAllowsCall,
  resolveApiToken,
  type ApiTokenScopeT,
  type ApiTokenContextT,
};
