import { z } from "zod";

import { RELATIVE_PATH_REGEX } from "../types";

/**
 * One-click templates ("blueprints").
 *
 * A blueprint is a directory in the template catalogue holding three files:
 *
 *   docker-compose.yml   the stack itself, plain Compose syntax
 *   template.json        this schema: metadata + variables + domains + env + mounts
 *   logo.svg             shown in the catalogue UI
 *
 * `template.json` never contains a secret. It declares *how* to derive one —
 * `"secret_key_base": "${base64:64}"` — and the API generates a fresh value per
 * deployment (see services/template-variables.ts). That is what keeps the
 * catalogue publishable while every install ends up with distinct credentials.
 *
 * The resolved values are substituted into `domains`, `env` and `mounts`, then
 * merged into the Compose file before it is handed to `docker compose`.
 */

/** Blueprint id / directory name: lowercase, hyphen-separated. */
const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;

/** Variable name usable as `${name}` — also the key shape of `variables`. */
const VARIABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Environment variable name, same rule the app router already enforces. */
const ENV_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** A Compose service name, as written under `services:` in the YAML. */
const COMPOSE_SERVICE_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Matches one `${helper}` or `${helper:argument}` placeholder.
 *
 * Kept non-global on purpose: a global regex carries `lastIndex` between calls,
 * which silently skips matches when the same instance is reused. Callers that
 * need to scan build their own with the `g` flag from `TEMPLATE_VARIABLE_SOURCE`.
 */
const TEMPLATE_VARIABLE_SOURCE = "\\$\\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]*))?\\}";

const templateLinksSchema = z.object({
  github: z.string().url().max(500).optional(),
  website: z.string().url().max(500).optional(),
  docs: z.string().url().max(500).optional(),
});

/**
 * The subset of a blueprint that the catalogue index carries, so the Templates
 * page can render cards without fetching every blueprint in full.
 */
const templateMetaSchema = z.object({
  id: z.string().min(1).max(64).regex(TEMPLATE_ID_REGEX, "Invalid template id"),
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  /** File name inside the blueprint directory, e.g. "logo.svg". */
  logo: z.string().max(100).optional(),
  links: templateLinksSchema.default({}),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
});

/**
 * Routes `host` to `port` of the named Compose service. Everything else about
 * Traefik (entrypoints, cert resolver, HTTP→HTTPS redirect) is derived by the
 * API, so a blueprint never hardcodes deployment-specific routing.
 */
const templateDomainSchema = z.object({
  service: z
    .string()
    .min(1)
    .max(100)
    .regex(COMPOSE_SERVICE_REGEX, "Invalid Compose service name"),
  port: z.number().int().min(1).max(65535),
  /** May contain `${var}` references — typically `${main_domain}`. */
  host: z.string().min(1).max(255),
  path: z.string().max(255).optional(),
});

/**
 * A configuration file the stack needs on disk. Written under the stack
 * directory and bind-mounted in by the Compose transformer.
 *
 * `filePath` is forced relative and traversal-free: it is joined onto a
 * server-side directory, so "../../etc/passwd" would otherwise let a catalogue
 * author write anywhere the API can reach.
 */
const templateMountSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .max(255)
    .regex(RELATIVE_PATH_REGEX, "Invalid mount file path"),
  content: z.string().max(100_000),
});

/** The full contents of a blueprint's `template.json`. */
const templateSpecSchema = templateMetaSchema.extend({
  /**
   * Named values derived once per deployment. Each entry's value is either a
   * literal or a single `${helper}` call; `${jwt:...}` may reference another
   * entry by name.
   */
  variables: z
    .record(
      z.string().min(1).max(64).regex(VARIABLE_NAME_REGEX, "Invalid variable name"),
      z.string().max(2_000),
    )
    .default({}),
  domains: z.array(templateDomainSchema).max(10).default([]),
  env: z
    .record(
      z.string().min(1).max(256).regex(ENV_KEY_REGEX, "Invalid env var name"),
      z.string().max(10_000),
    )
    .default({}),
  mounts: z.array(templateMountSchema).max(20).default([]),
});

/** What the catalogue publishes at `index.json`. */
const templateIndexSchema = z.array(templateMetaSchema);

/**
 * A blueprint loaded in full: its spec plus the raw Compose file. Not a file on
 * disk — the catalogue service assembles it from `template.json` +
 * `docker-compose.yml`.
 */
const templateSchema = z.object({
  spec: templateSpecSchema,
  compose: z.string().min(1).max(500_000),
});

type TemplateLinksT = z.infer<typeof templateLinksSchema>;
type TemplateMetaT = z.infer<typeof templateMetaSchema>;
type TemplateDomainT = z.infer<typeof templateDomainSchema>;
type TemplateMountT = z.infer<typeof templateMountSchema>;
type TemplateSpecT = z.infer<typeof templateSpecSchema>;
type TemplateT = z.infer<typeof templateSchema>;

export {
  TEMPLATE_ID_REGEX,
  VARIABLE_NAME_REGEX,
  TEMPLATE_VARIABLE_SOURCE,
  templateLinksSchema,
  templateMetaSchema,
  templateDomainSchema,
  templateMountSchema,
  templateSpecSchema,
  templateIndexSchema,
  templateSchema,
  type TemplateLinksT,
  type TemplateMetaT,
  type TemplateDomainT,
  type TemplateMountT,
  type TemplateSpecT,
  type TemplateT,
};
