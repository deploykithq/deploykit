import {
  templateIndexSchema,
  templateSchema,
  templateSpecSchema,
  type TemplateMetaT,
  type TemplateT,
} from "@deploykit/shared";
import {
  BUNDLED_INDEX,
  getBundledTemplate,
  getBundledLogo,
} from "@deploykit/templates";

import { redis } from "../lib/redis";
import { assertSafeUrl } from "../lib/ssrf";

/**
 * The template catalogue.
 *
 * Blueprints live in their own repository so publishing one does not require a
 * DeployKit release. This module fetches them, caches them in Redis, and falls
 * back to the catalogue bundled inside the image whenever the remote cannot be
 * used — an unreachable registry must degrade the catalogue, never empty it.
 *
 * Nothing here is authenticated: the registry is public data. Access control
 * happens at the router, and the *deployment* of a blueprint is what needs a
 * project role.
 */

const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/deploykithq/templates/main";

const registryUrl = (): string =>
  (process.env.TEMPLATES_REGISTRY_URL || DEFAULT_REGISTRY_URL).replace(
    /\/+$/,
    "",
  );

const CACHE_TTL_SEC = 60 * 60;
const FETCH_TIMEOUT_MS = 10_000;
/** A blueprint is a few KB of text; anything near this is not one. */
const MAX_RESPONSE_BYTES = 2_000_000;

const INDEX_CACHE_KEY = "templates:index";
const blueprintCacheKey = (id: string) => `templates:blueprint:${id}`;

type CatalogSourceT = "remote" | "bundled";

/**
 * A catalogue entry as the API hands it to the web: the blueprint's metadata
 * plus a resolved `logoUrl`. The URL is derived, never authored — a blueprint
 * only names its logo file, and where that file is served from depends on
 * whether the entry came from the registry or the bundle.
 */
type CatalogEntryT = TemplateMetaT & { logoUrl?: string };

interface CatalogListI {
  templates: CatalogEntryT[];
  source: CatalogSourceT;
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

/** Absolute URL of a blueprint's logo in the registry, or an inlined bundled one. */
const logoUrlFor = (
  meta: TemplateMetaT,
  source: CatalogSourceT,
): string | undefined => {
  if (!meta.logo) return undefined;

  if (source === "bundled") {
    const svg = getBundledLogo(meta.id);
    return svg
      ? `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
      : undefined;
  }
  return `${registryUrl()}/blueprints/${meta.id}/${meta.logo}`;
};

const withLogoUrls = (
  templates: TemplateMetaT[],
  source: CatalogSourceT,
): CatalogEntryT[] =>
  templates.map((meta) => {
    const logoUrl = logoUrlFor(meta, source);
    return logoUrl ? { ...meta, logoUrl } : meta;
  });

/**
 * The catalogue index.
 *
 * Cache misses hit the registry; any failure at all — network, HTTP status,
 * malformed JSON, schema drift — falls back to the bundled catalogue and logs
 * once. Callers get a list either way.
 */
const listTemplates = async (): Promise<CatalogListI> => {
  const cached = await redis.get(INDEX_CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      const parsed = templateIndexSchema.parse(JSON.parse(cached));
      return { templates: withLogoUrls(parsed, "remote"), source: "remote" };
    } catch {
      // Poisoned cache entry — drop it and re-fetch below.
      await redis.del(INDEX_CACHE_KEY).catch(() => {});
    }
  }

  try {
    const body = await fetchText(`${registryUrl()}/index.json`);
    const templates = templateIndexSchema.parse(JSON.parse(body));
    await redis
      .set(INDEX_CACHE_KEY, JSON.stringify(templates), "EX", CACHE_TTL_SEC)
      .catch(() => {});
    return { templates: withLogoUrls(templates, "remote"), source: "remote" };
  } catch (err: any) {
    console.warn(
      `[templates] Registry unavailable (${err?.message ?? err}); serving the bundled catalogue`,
    );
    return {
      templates: withLogoUrls(BUNDLED_INDEX, "bundled"),
      source: "bundled",
    };
  }
};

/**
 * One blueprint in full (spec + Compose file).
 *
 * @returns the blueprint, or null when neither the registry nor the bundled
 *          catalogue has it.
 */
const getTemplate = async (id: string): Promise<TemplateT | null> => {
  const cached = await redis.get(blueprintCacheKey(id)).catch(() => null);
  if (cached) {
    try {
      return templateSchema.parse(JSON.parse(cached));
    } catch {
      await redis.del(blueprintCacheKey(id)).catch(() => {});
    }
  }

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
      throw new Error(
        `Blueprint at /blueprints/${id} declares id "${template.spec.id}"`,
      );
    }

    await redis
      .set(blueprintCacheKey(id), JSON.stringify(template), "EX", CACHE_TTL_SEC)
      .catch(() => {});
    return template;
  } catch (err: any) {
    const bundled = getBundledTemplate(id);
    if (bundled) {
      console.warn(
        `[templates] Could not fetch "${id}" (${err?.message ?? err}); using the bundled copy`,
      );
      return bundled;
    }
    console.warn(`[templates] Unknown template "${id}": ${err?.message ?? err}`);
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
