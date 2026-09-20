import {
  templateIndexSchema,
  templateSchema,
  templateSpecSchema,
  type TemplateMetaT,
  type TemplateT,
} from "@deploykit/shared";

import { redis } from "../lib/redis";
import { assertSafeUrl } from "../lib/ssrf";

/**
 * The template catalogue.
 *
 * Blueprints live in their own repository (`deploykithq/deploykit-templates`),
 * not in this one: publishing a template is a commit there, and every install
 * picks it up within the hour without a DeployKit release. Nothing is bundled
 * into the image, so this module is the only way the catalogue reaches the UI.
 *
 * That makes the cache load-bearing rather than an optimisation. It is
 * stale-while-error: an entry stays usable for 30 days, but the registry is
 * re-read once an hour, and a failed read keeps serving the last copy that
 * validated instead of emptying the page. Only an install that has never
 * reached the registry has nothing to show.
 *
 * Nothing here is authenticated: the registry is public data. Access control
 * happens at the router, and the *deployment* of a blueprint is what needs a
 * project role.
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
/** A blueprint is a few KB of text; anything near this is not one. */
const MAX_RESPONSE_BYTES = 2_000_000;

const INDEX_CACHE_KEY = "templates:index";
const blueprintCacheKey = (id: string) => `templates:blueprint:${id}`;

/**
 * Where the catalogue in hand came from.
 *
 * `stale` and `unavailable` both mean the registry is unreachable right now;
 * they differ in whether there is anything to show, and the UI says so.
 */
type CatalogSourceT = "remote" | "stale" | "unavailable";

/**
 * A catalogue entry as the API hands it to the web: the blueprint's metadata
 * plus a resolved `logoUrl`. The URL is derived, never authored — a blueprint
 * only names its logo file, and the registry serves it alongside.
 */
type CatalogEntryT = TemplateMetaT & { logoUrl?: string };

interface CatalogListI {
  templates: CatalogEntryT[];
  source: CatalogSourceT;
  /** Why the registry could not be read, when it could not be. */
  error?: string;
  /** When the copy being served was fetched. Set only for `stale`. */
  cachedAt?: string;
}

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

/** Absolute URL of a blueprint's logo in the registry. */
const withLogoUrls = (templates: TemplateMetaT[]): CatalogEntryT[] => {
  const base = registryUrl();
  return templates.map((meta) =>
    meta.logo
      ? { ...meta, logoUrl: `${base}/blueprints/${meta.id}/${meta.logo}` }
      : meta,
  );
};

/**
 * The catalogue index.
 *
 * Never throws: a Templates page that renders an explanation is more useful
 * than one that renders an error boundary.
 */
const listTemplates = async (): Promise<CatalogListI> => {
  const cached = await readCache(INDEX_CACHE_KEY, (v) =>
    templateIndexSchema.parse(v),
  );

  if (cached && isFresh(cached)) {
    return { templates: withLogoUrls(cached.value), source: "remote" };
  }

  try {
    const body = await fetchText(`${registryUrl()}/index.json`);
    const templates = templateIndexSchema.parse(JSON.parse(body));
    await writeCache(INDEX_CACHE_KEY, templates);
    return { templates: withLogoUrls(templates), source: "remote" };
  } catch (err: any) {
    const message = err?.message ?? String(err);

    if (cached) {
      console.warn(
        `[templates] Registry unreachable (${message}); serving the cached catalogue from ${new Date(cached.fetchedAt).toISOString()}`,
      );
      return {
        templates: withLogoUrls(cached.value),
        source: "stale",
        error: message,
        cachedAt: new Date(cached.fetchedAt).toISOString(),
      };
    }

    console.warn(
      `[templates] Registry unreachable (${message}) and nothing is cached; the catalogue is empty`,
    );
    return { templates: [], source: "unavailable", error: message };
  }
};

/**
 * One blueprint in full (spec + Compose file).
 *
 * @returns the blueprint, or null when the registry cannot serve it and no
 *          cached copy is left.
 */
const getTemplate = async (id: string): Promise<TemplateT | null> => {
  const key = blueprintCacheKey(id);
  const cached = await readCache(key, (v) => templateSchema.parse(v));

  if (cached && isFresh(cached)) return cached.value;

  try {
    const base = `${registryUrl()}/blueprints/${encodeURIComponent(id)}`;
    const [specBody, compose] = await Promise.all([
      fetchText(`${base}/template.json`),
      fetchText(`${base}/docker-compose.yml`),
    ]);

    const template: TemplateT = {
      spec: templateSpecSchema.parse(JSON.parse(specBody)),
      compose,
    };
    if (template.spec.id !== id) {
      // Deploying something whose id differs from the one that was asked for
      // is a supply-chain problem, not a typo.
      throw new Error(
        `Blueprint at /blueprints/${id} declares id "${template.spec.id}"`,
      );
    }

    await writeCache(key, template);
    return template;
  } catch (err: any) {
    const message = err?.message ?? String(err);

    if (cached) {
      console.warn(
        `[templates] Could not refresh "${id}" (${message}); using the cached copy`,
      );
      return cached.value;
    }

    console.warn(`[templates] Cannot serve "${id}": ${message}`);
    return null;
  }
};

/** Drop every cached catalogue entry so the next read re-fetches. */
const refreshCatalog = async (): Promise<{ cleared: number }> => {
  const keys = await redis.keys("templates:*");
  if (keys.length === 0) return { cleared: 0 };
  await redis.del(...keys);
  return { cleared: keys.length };
};

/**
 * Validate a blueprint supplied by the user (pasted, or fetched from a URL they
 * gave). Same schema as the catalogue's, so an imported template behaves
 * exactly like a published one.
 */
const parseTemplate = (specJson: string, compose: string): TemplateT => {
  let raw: unknown;
  try {
    raw = JSON.parse(specJson);
  } catch {
    throw new Error("template.json is not valid JSON");
  }
  return templateSchema.parse({
    spec: templateSpecSchema.parse(raw),
    compose,
  });
};

/** Fetch and validate a blueprint from an arbitrary user-supplied base URL. */
const fetchTemplateFromUrl = async (baseUrl: string): Promise<TemplateT> => {
  const base = baseUrl.replace(/\/+$/, "");
  const [specBody, compose] = await Promise.all([
    fetchText(`${base}/template.json`),
    fetchText(`${base}/docker-compose.yml`),
  ]);
  return parseTemplate(specBody, compose);
};

export {
  listTemplates,
  getTemplate,
  refreshCatalog,
  parseTemplate,
  fetchTemplateFromUrl,
  registryUrl,
  DEFAULT_REGISTRY_URL,
  type CatalogEntryT,
  type CatalogListI,
  type CatalogSourceT,
};
