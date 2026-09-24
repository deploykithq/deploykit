import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";

import { db } from "../db/index";
import { githubInstallations } from "../db/schema/index";
import type { GithubAppT, GithubInstallationT } from "../db/schema/index";
import { encrypt, decrypt } from "../lib/encryption";
import { redis } from "../lib/redis";
import { ghRequest, ghPaginate, GitHubApiError } from "./github-client";

/** App JWTs may live 10 minutes; 9 leaves room for clock drift. */
const APP_JWT_TTL_SEC = 540;
/**
 * GitHub rejects a JWT whose `iat` sits in its future, so the issue time is
 * backdated to absorb clock skew between this host and theirs.
 */
const APP_JWT_SKEW_SEC = 60;
/** Installation tokens last an hour; stop using ours five minutes early. */
const TOKEN_SAFETY_MARGIN_SEC = 300;
const REPO_CACHE_TTL_SEC = 300;
const REPO_NAME_CACHE_TTL_SEC = 3600;
const APP_CACHE_TTL_MS = 30_000;

interface GhRepoI {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

/**
 * In-process single-flight for token minting.
 *
 * The promise is cached, not its value: a burst of concurrent deploys on one
 * installation mints once and everybody waits on the same request.
 */
const inFlightTokens = new Map<string, Promise<string>>();

let appCache: { row: GithubAppT | null; at: number } | null = null;

/** The registered GitHub App, or null when the instance has none. */
const getGitHubApp = async (): Promise<GithubAppT | null> => {
  if (appCache && Date.now() - appCache.at < APP_CACHE_TTL_MS) {
    return appCache.row;
  }
  const row = (await db.query.githubApps.findFirst()) ?? null;
  appCache = { row, at: Date.now() };
  return row;
};

/** Drop the cached App row — call after any write to `github_apps`. */
const invalidateGitHubApp = (): void => {
  appCache = null;
};

/** Sign a short-lived App JWT. Authenticates us as the App, not as a user. */
const signAppJwt = (app: GithubAppT): string => {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - APP_JWT_SKEW_SEC,
      exp: now + APP_JWT_TTL_SEC,
      iss: String(app.appId),
    },
    decrypt(app.privateKey),
    { algorithm: "RS256" },
  );
};

/** Auth material for an App-level endpoint (`/app`, `/app/installations`). */
const appAuth = (app: GithubAppT) =>
  ({ scheme: "Bearer", value: signAppJwt(app) }) as const;

const tokenCacheKey = (installationId: number) => `gh:itok:${installationId}`;

/** Forget a cached installation token: its key rotated, or it was rejected. */
const invalidateInstallationToken = async (
  installationId: number,
): Promise<void> => {
  inFlightTokens.delete(String(installationId));
  await redis.del(tokenCacheKey(installationId));
};

const mintInstallationToken = async (
  app: GithubAppT,
  installation: GithubInstallationT,
): Promise<string> => {
  const { data } = await ghRequest<{ token: string; expires_at: string }>(
    `/app/installations/${installation.installationId}/access_tokens`,
    { method: "POST", auth: appAuth(app), baseUrl: app.apiBaseUrl },
  );

  const ttl =
    Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000) -
    TOKEN_SAFETY_MARGIN_SEC;
  if (ttl > 0) {
    // Encrypted at rest, like every other secret this instance stores.
    await redis.set(
      tokenCacheKey(installation.installationId),
      encrypt(data.token),
      "EX",
      ttl,
    );
  }
  return data.token;
};

/** Read the cache, then mint. Only ever run one at a time per installation. */
const loadInstallationToken = async (
  installation: GithubInstallationT,
): Promise<string> => {
  const cached = await redis.get(tokenCacheKey(installation.installationId));
  if (cached) {
    try {
      return decrypt(cached);
    } catch {
      // ENCRYPTION_KEY changed under us — drop it and mint a fresh one.
      await redis.del(tokenCacheKey(installation.installationId));
    }
  }

  const app = await getGitHubApp();
  if (!app) throw new Error("No GitHub App is configured on this instance.");
  return mintInstallationToken(app, installation);
};

/**
 * A usable installation token, from cache when possible.
 *
 * Redis rather than memory alone: a bare Map re-mints on every restart and
 * would not survive splitting the workers out of the API process.
 *
 * The in-flight promise is registered before this function's first `await`, so
 * a burst of concurrent deploys on one installation makes a single request —
 * checking the map after an await would let all of them race past it.
 */
const getInstallationToken = (
  installation: GithubInstallationT,
): Promise<string> => {
  if (installation.suspendedAt) {
    return Promise.reject(
      new Error(
        `The GitHub App installation for "${installation.accountLogin}" is suspended.`,
      ),
    );
  }

  const key = String(installation.installationId);
  const pending = inFlightTokens.get(key);
  if (pending) return pending;

  const promise = loadInstallationToken(installation).finally(() => {
    inFlightTokens.delete(key);
  });
  inFlightTokens.set(key, promise);
  return promise;
};

/** Auth material for an installation-scoped endpoint. */
const installationAuth = async (installation: GithubInstallationT) =>
  ({
    scheme: "token",
    value: await getInstallationToken(installation),
  }) as const;

/**
 * Run a request as an installation, re-minting once on 401.
 *
 * A cached token can be revoked out from under us (the key rotated, or the
 * installation was reconfigured), which is indistinguishable from expiry at
 * the call site.
 */
const asInstallation = async <T>(
  installation: GithubInstallationT,
  path: string,
  opts: Parameters<typeof ghRequest>[1] = {},
): Promise<T> => {
  const app = await getGitHubApp();
  const baseUrl = opts.baseUrl ?? app?.apiBaseUrl;
  try {
    const { data } = await ghRequest<T>(path, {
      ...opts,
      baseUrl,
      auth: await installationAuth(installation),
    });
    return data;
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 401) {
      await invalidateInstallationToken(installation.installationId);
      const { data } = await ghRequest<T>(path, {
        ...opts,
        baseUrl,
        auth: await installationAuth(installation),
      });
      return data;
    }
    throw err;
  }
};

const toRepo = (r: any): GhRepoI => ({
  id: r.id,
  fullName: r.full_name,
  name: r.name,
  private: !!r.private,
  defaultBranch: r.default_branch || "main",
  htmlUrl: r.html_url,
});

/**
 * Every repository an installation can see.
 *
 * Deliberately not a table: a synced copy drifts on rename, transfer and
 * revocation, and the only cost of asking GitHub is a cache miss.
 */
const listInstallationRepositories = async (
  installation: GithubInstallationT,
): Promise<{ repos: GhRepoI[]; truncated: boolean }> => {
  const cacheKey = `gh:repos:${installation.installationId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const app = await getGitHubApp();
  const { items, truncated } = await ghPaginate<GhRepoI>(
    "/installation/repositories?per_page=100",
    {
      baseUrl: app?.apiBaseUrl,
      auth: await installationAuth(installation),
    },
    (page) => (page?.repositories ?? []).map(toRepo),
  );

  const result = {
    repos: items.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    truncated,
  };
  await redis.set(cacheKey, JSON.stringify(result), "EX", REPO_CACHE_TTL_SEC);
  return result;
};

/** Forget an installation's repository list: it gained or lost access. */
const invalidateRepositoryCache = async (
  installationId: number,
): Promise<void> => {
  await redis.del(`gh:repos:${installationId}`);
};

/**
 * Resolve `owner/repo` from GitHub's numeric repo id.
 *
 * Going through the id rather than a stored name is what makes the integration
 * survive a rename or a transfer without subscribing to `repository` events.
 */
const resolveRepoFullName = async (
  installation: GithubInstallationT,
  repoId: number,
): Promise<string> => {
  const cacheKey = `gh:reponame:${repoId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const repo = await asInstallation<{ full_name: string }>(
    installation,
    `/repositories/${repoId}`,
  );
  await redis.set(cacheKey, repo.full_name, "EX", REPO_NAME_CACHE_TTL_SEC);
  return repo.full_name;
};

/** Whether an installation can actually reach a given repository. */
const installationCanAccessRepo = async (
  installation: GithubInstallationT,
  repoId: number,
): Promise<GhRepoI | null> => {
  const { repos } = await listInstallationRepositories(installation);
  return repos.find((r) => r.id === repoId) ?? null;
};

/** Branch names of a repository. */
const listRepositoryBranches = async (
  installation: GithubInstallationT,
  fullName: string,
): Promise<string[]> => {
  const app = await getGitHubApp();
  const { items } = await ghPaginate<string>(
    `/repos/${fullName}/branches?per_page=100`,
    {
      baseUrl: app?.apiBaseUrl,
      auth: await installationAuth(installation),
    },
    (page) => (page ?? []).map((b: any) => b.name as string),
    3,
  );
  return items;
};

/** Load an installation row by its local uuid. */
const getInstallationById = async (
  id: string,
): Promise<GithubInstallationT | null> =>
  (await db.query.githubInstallations.findFirst({
    where: eq(githubInstallations.id, id),
  })) ?? null;

/** Load an installation row by GitHub's numeric id. */
const getInstallationByGithubId = async (
  installationId: number,
): Promise<GithubInstallationT | null> =>
  (await db.query.githubInstallations.findFirst({
    where: eq(githubInstallations.installationId, installationId),
  })) ?? null;

export {
  getGitHubApp,
  invalidateGitHubApp,
  signAppJwt,
  appAuth,
  getInstallationToken,
  invalidateInstallationToken,
  asInstallation,
  listInstallationRepositories,
  invalidateRepositoryCache,
  resolveRepoFullName,
  installationCanAccessRepo,
  listRepositoryBranches,
  getInstallationById,
  getInstallationByGithubId,
  type GhRepoI,
};
