/**
 * A minimal GitHub REST client.
 *
 * Seven endpoints do not justify Octokit and the dependency tree, retry plugins
 * and throttling config that come with it: Node 20 ships fetch, and the two
 * behaviours that actually matter here (rate-limit backoff and a bounded
 * timeout) are a dozen lines each.
 *
 * Nothing in this module knows how to authenticate — callers pass the scheme
 * and value, so App JWTs and installation tokens go through the same path.
 */

const DEFAULT_API_BASE = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const API_VERSION = "2022-11-28";
/** Longest we will ever sit on a rate-limited request before giving up. */
const MAX_RATE_LIMIT_WAIT_MS = 30_000;

/** An error carrying GitHub's own status and message, never a credential. */
class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly docUrl?: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

interface GhAuthI {
  /** "Bearer" for an App JWT, "token" for an installation token. */
  scheme: "Bearer" | "token";
  value: string;
}

interface GhRequestOptsI {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: GhAuthI;
  baseUrl?: string;
  timeoutMs?: number;
  /** An absolute URL, used when following a Link rel="next" header. */
  absoluteUrl?: string;
}

interface GhResponseI<T> {
  data: T;
  headers: Headers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long to wait before retrying, or null when the response is final. */
const retryDelayMs = (res: Response, attempt: number): number | null => {
  if (res.status >= 500 && res.status < 600) {
    if (attempt >= 2) return null;
    // Exponential backoff with jitter, so a fleet of workers doesn't retry
    // in lockstep against an already struggling API.
    return 2 ** attempt * 500 + Math.floor(Math.random() * 250);
  }

  if (res.status !== 403 && res.status !== 429) return null;
  if (attempt >= 1) return null;

  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RATE_LIMIT_WAIT_MS);
  }

  // A 403 is only a rate limit when the budget is actually exhausted;
  // otherwise it is a permissions problem and retrying changes nothing.
  if (res.headers.get("x-ratelimit-remaining") !== "0") return null;

  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(reset)) return null;
  const waitMs = reset * 1000 - Date.now();
  if (waitMs <= 0) return 0;
  return Math.min(waitMs, MAX_RATE_LIMIT_WAIT_MS);
};

/** Pull GitHub's own error text out of a failed response. */
const errorFromResponse = async (res: Response): Promise<GitHubApiError> => {
  let message = res.statusText || `HTTP ${res.status}`;
  let docUrl: string | undefined;
  try {
    const body: any = await res.json();
    if (body?.message) message = String(body.message);
    if (body?.documentation_url) docUrl = String(body.documentation_url);
    // Validation failures carry the useful detail one level down.
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      const detail = body.errors
        .map((e: any) => e?.message || `${e?.field}: ${e?.code}`)
        .filter(Boolean)
        .join("; ");
      if (detail) message = `${message} (${detail})`;
    }
  } catch {
    // Not JSON — the status line is all we have.
  }
  return new GitHubApiError(res.status, message, docUrl);
};

/**
 * Perform one GitHub API request.
 *
 * Throws GitHubApiError on any non-2xx that survives the retry policy. The
 * request's credentials never appear in the thrown message.
 */
const ghRequest = async <T>(
  path: string,
  opts: GhRequestOptsI = {},
): Promise<GhResponseI<T>> => {
  const url =
    opts.absoluteUrl ?? `${opts.baseUrl ?? DEFAULT_API_BASE}${path}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "DeployKit",
  };
  if (opts.auth) {
    headers.Authorization = `${opts.auth.scheme} ${opts.auth.value}`;
  }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        // A hung request must never hold a deploy worker open.
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err: any) {
      const reason =
        err?.name === "TimeoutError" || err?.name === "AbortError"
          ? "request timed out"
          : err?.message || "network error";
      throw new GitHubApiError(0, `GitHub request failed: ${reason}`);
    }

    if (res.ok) {
      const text = await res.text();
      return {
        data: (text ? JSON.parse(text) : undefined) as T,
        headers: res.headers,
      };
    }

    const delay = retryDelayMs(res, attempt);
    if (delay === null) throw await errorFromResponse(res);
    await sleep(delay);
  }
};

/** Parse the `rel="next"` URL out of a Link header, if there is one. */
const nextLink = (headers: Headers): string | undefined => {
  const link = headers.get("link");
  if (!link) return undefined;
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return undefined;
};

/**
 * Follow `Link: rel="next"` and concatenate pages.
 *
 * `maxPages` is a guard, not a target: an account with thousands of
 * repositories should hit the UI's search box, not stall a request here.
 */
const ghPaginate = async <T>(
  path: string,
  opts: GhRequestOptsI,
  pick: (page: any) => T[],
  maxPages = 5,
): Promise<{ items: T[]; truncated: boolean }> => {
  const items: T[] = [];
  let url: string | undefined = `${opts.baseUrl ?? DEFAULT_API_BASE}${path}`;

  for (let page = 0; page < maxPages; page++) {
    const res: GhResponseI<any> = await ghRequest<any>("", {
      ...opts,
      absoluteUrl: url,
    });
    items.push(...pick(res.data));
    url = nextLink(res.headers);
    if (!url) return { items, truncated: false };
  }
  return { items, truncated: true };
};

export {
  GitHubApiError,
  ghRequest,
  ghPaginate,
  DEFAULT_API_BASE,
  type GhAuthI,
  type GhRequestOptsI,
};
