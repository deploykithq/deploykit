import { createHash } from "crypto";

import { redis } from "../../lib/redis";

/**
 * HTTP for mod catalogues. Only fixed provider hosts are ever requested —
 * callers build URLs from constants and parsed ids, never from user input.
 * URLs may carry an API key (Steam), so they are hashed for the cache key
 * and never logged.
 */

type ModSourceErrorCodeT = "NOT_FOUND" | "UNAUTHORIZED" | "UNAVAILABLE" | "BAD_REQUEST";

class ModSourceError extends Error {
  constructor(
    public code: ModSourceErrorCodeT,
    message: string,
  ) {
    super(message);
    this.name = "ModSourceError";
  }
}

const TIMEOUT_MS = 10_000;

const fetchJson = async <T>(
  url: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    /** Cache the parsed response in Redis for this long. */
    cacheSec?: number;
    /** "Modrinth" — used in error messages. */
    what: string;
  },
): Promise<T> => {
  const cacheKey = init.cacheSec
    ? `modsrc:${createHash("sha1")
        .update(`${init.method ?? "GET"} ${url} ${init.body ?? ""}`)
        .digest("hex")}`
    : null;
  if (cacheKey) {
    const hit = await redis.get(cacheKey).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ModSourceError("UNAVAILABLE", `${init.what} did not answer. Try again later.`);
  }
  if (res.status === 404) throw new ModSourceError("NOT_FOUND", `Not found on ${init.what}`);
  if (res.status === 401 || res.status === 403) {
    throw new ModSourceError("UNAUTHORIZED", `${init.what} rejected the API key`);
  }
  if (!res.ok) throw new ModSourceError("UNAVAILABLE", `${init.what} answered ${res.status}`);

  const data = (await res.json()) as T;
  if (cacheKey) {
    await redis.set(cacheKey, JSON.stringify(data), "EX", init.cacheSec!).catch(() => {});
  }
  return data;
};

export { fetchJson, ModSourceError, type ModSourceErrorCodeT };
