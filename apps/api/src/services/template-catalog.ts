import {
  templateIndexSchema,
  templateSchema,
  templateSpecSchema,
  type TemplateMetaT,
  type TemplateT,
} from "@deploykit/shared";

import {
  DEFAULT_REGISTRY_URL,
  cachedRegistryRead,
  clearRegistryCache,
  fetchText,
  registryUrl,
  type CatalogSourceT,
} from "./registry-cache";

/**
 * The template catalogue.
 *
 * Blueprints live in their own repository (`deploykithq/deploykit-templates`),
 * not in this one: publishing a template is a commit there, and every install
 * picks it up within the hour without a DeployKit release. Nothing is bundled
 * into the image, so this module is the only way the catalogue reaches the UI.
 *
 * That makes the cache load-bearing rather than an optimisation; it lives in
 * `registry-cache.ts`, shared with the game catalogue.
 *
 * Nothing here is authenticated: the registry is public data. Access control
 * happens at the router, and the *deployment* of a blueprint is what needs a
 * project role.
 */

const INDEX_CACHE_KEY = "templates:index";
const blueprintCacheKey = (id: string) => `templates:blueprint:${id}`;

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
  const read = await cachedRegistryRead({
    key: INDEX_CACHE_KEY,
    parse: (v) => templateIndexSchema.parse(v),
    load: async () =>
      templateIndexSchema.parse(
        JSON.parse(await fetchText(`${registryUrl()}/index.json`)),
      ),
  });

  if (read.source === "stale") {
    console.warn(
      `[templates] Registry unreachable (${read.error}); serving the cached catalogue from ${read.cachedAt}`,
    );
  } else if (read.source === "unavailable") {
    console.warn(
      `[templates] Registry unreachable (${read.error}) and nothing is cached; the catalogue is empty`,
    );
  }

  return {
    templates: withLogoUrls(read.value ?? []),
    source: read.source,
    ...(read.error ? { error: read.error } : {}),
    ...(read.cachedAt ? { cachedAt: read.cachedAt } : {}),
  };
};

/**
 * One blueprint in full (spec + Compose file).
 *
 * @returns the blueprint, or null when the registry cannot serve it and no
 *          cached copy is left.
 */
const getTemplate = async (id: string): Promise<TemplateT | null> => {
  const read = await cachedRegistryRead({
    key: blueprintCacheKey(id),
    parse: (v) => templateSchema.parse(v),
    load: async () => {
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
        // Deploying something whose id differs from the one that was asked
        // for is a supply-chain problem, not a typo.
        throw new Error(
          `Blueprint at /blueprints/${id} declares id "${template.spec.id}"`,
        );
      }
      return template;
    },
  });

  if (read.source === "stale") {
    console.warn(
      `[templates] Could not refresh "${id}" (${read.error}); using the cached copy`,
    );
  } else if (read.source === "unavailable") {
    console.warn(`[templates] Cannot serve "${id}": ${read.error}`);
  }
  return read.value;
};

/** Drop every cached catalogue entry so the next read re-fetches. */
const refreshCatalog = (): Promise<{ cleared: number }> =>
  clearRegistryCache("templates:");

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
