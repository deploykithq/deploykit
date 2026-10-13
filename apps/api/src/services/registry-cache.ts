import { redis } from "../lib/redis";
import { assertSafeUrl } from "../lib/ssrf";

/**
 * Reading from the public registry (`deploykithq/deploykit-templates`), shared
 * by every catalogue that lives there: Compose blueprints and game definitions.
 *
 * The cache is load-bearing rather than an optimisation. It is
 * stale-while-error: an entry stays usable for 30 days, but the registry is
 * re-read once an hour, and a failed read keeps serving the last copy that
 * validated instead of emptying the page. Only an install that has never
 * reached the registry has nothing to show.
 */

const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/deploykithq/deploykit-templates/master";

const registryUrl = (): string =>
  (process.env.TEMPLATES_REGISTRY_URL || DEFAULT_REGISTRY_URL).replace(
    /\/+$/,
    "",
  );

/** How old a cached copy may be before the registry is consulted again. */
const FRESH_FOR_MS = 60 * 60 * 1000;
/** How long a copy stays worth serving when the registry cannot be reached. */
const CACHE_TTL_SEC = 30 * 24 * 60 * 60;

const FETCH_TIMEOUT_MS = 10_000;
/** A definition is a few KB of text; anything near this is not one. */
const MAX_RESPONSE_BYTES = 2_000_000;

/**
 * Where the value in hand came from.
 *
 * `stale` and `unavailable` both mean the registry is unreachable right now;
 * they differ in whether there is anything to show, and the UI says so.
 */
type CatalogSourceT = "remote" | "stale" | "unavailable";

interface CachedI<T> {
  fetchedAt: number;
  value: T;
}

/**
 * Fetch text from the registry with a timeout and a size cap.
 *
 * The URL is SSRF-checked even though only an admin can set the registry base:
 * `TEMPLATES_REGISTRY_URL` is read from the environment, so a compromised or
 * careless deployment could otherwise turn the catalogue into a probe of the
 * private network the API sits in.
 */
const fetchText = async (url: string): Promise<string> => {
  await assertSafeUrl(url);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "text/plain, application/json" },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Registry responded ${response.status} for ${url}`);
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) {
    throw new Error(`Registry response too large (${declared} bytes)`);
  }

  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error("Registry response too large");
  }
  return body;
};

/**
 * Read a cache entry, dropping it if it no longer parses against the current
 * schema — a DeployKit upgrade can tighten one, and a poisoned entry would
 * otherwise keep failing until its 30 days ran out.
 */
const readCache = async <T>(
  key: string,
  parse: (raw: unknown) => T,
): Promise<CachedI<T> | null> => {
  const raw = await redis.get(key).catch(() => null);
  if (!raw) return null;

  try {
    const entry = JSON.parse(raw) as { fetchedAt?: number; value?: unknown };
    if (typeof entry?.fetchedAt !== "number") throw new Error("no fetchedAt");
    return { fetchedAt: entry.fetchedAt, value: parse(entry.value) };
  } catch {
    await redis.del(key).catch(() => {});
    return null;
  }
};

const writeCache = async <T>(key: string, value: T): Promise<void> => {
  await redis
    .set(
      key,
      JSON.stringify({ fetchedAt: Date.now(), value }),
      "EX",
      CACHE_TTL_SEC,
    )
    .catch(() => {});
};

const isFresh = (entry: CachedI<unknown>): boolean =>
  Date.now() - entry.fetchedAt < FRESH_FOR_MS;

interface CachedReadI<T> {
  /** null only when `source` is `unavailable`. */
  value: T | null;
  source: CatalogSourceT;
  /** Why the registry could not be read, when it could not be. */
  error?: string;
  /** When the copy being served was fetched. Set only for `stale`. */
  cachedAt?: string;
  /** When the copy being served was fetched (any source but `unavailable`). */
  fetchedAt?: number;
}

/**
 * Stale-while-error read of one registry entry.
 *
 * `load` fetches and validates the value; anything it throws counts as the
 * registry being unreachable. Never throws.
 */
const cachedRegistryRead = async <T>(opts: {
  key: string;
  parse: (raw: unknown) => T;
  load: () => Promise<T>;
}): Promise<CachedReadI<T>> => {
  const cached = await readCache(opts.key, opts.parse);
  if (cached && isFresh(cached)) {
    return { value: cached.value, source: "remote", fetchedAt: cached.fetchedAt };
  }

  try {
    const value = await opts.load();
    await writeCache(opts.key, value);
    return { value, source: "remote", fetchedAt: Date.now() };
  } catch (err: any) {
    const error = err?.message ?? String(err);
    if (cached) {
      return {
        value: cached.value,
        source: "stale",
        error,
        cachedAt: new Date(cached.fetchedAt).toISOString(),
        fetchedAt: cached.fetchedAt,
      };
    }
    return { value: null, source: "unavailable", error };
  }
};

/** Drop every cached entry under a key prefix so the next read re-fetches. */
const clearRegistryCache = async (
  prefix: string,
): Promise<{ cleared: number }> => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length === 0) return { cleared: 0 };
  await redis.del(...keys);
  return { cleared: keys.length };
};

export {
  DEFAULT_REGISTRY_URL,
  registryUrl,
  fetchText,
  cachedRegistryRead,
  clearRegistryCache,
  type CatalogSourceT,
  type CachedReadI,
};
