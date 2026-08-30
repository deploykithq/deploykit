import { BUNDLED_TEMPLATES, BUNDLED_LOGOS } from "./generated";

import type { TemplateMetaT, TemplateT } from "@deploykit/shared";

/**
 * The catalogue that ships inside DeployKit.
 *
 * It is the offline fallback for `services/template-catalog.ts`: when the
 * remote registry is unreachable, misconfigured or serving something that fails
 * validation, the Templates page falls back to this rather than going blank —
 * which matters for air-gapped installs, where the remote is never reachable.
 */

const BUNDLED_INDEX: TemplateMetaT[] = BUNDLED_TEMPLATES.map(({ spec }) => ({
  id: spec.id,
  name: spec.name,
  version: spec.version,
  description: spec.description,
  ...(spec.logo ? { logo: spec.logo } : {}),
  links: spec.links,
  tags: spec.tags,
}));

const getBundledTemplate = (id: string): TemplateT | undefined =>
  BUNDLED_TEMPLATES.find((t) => t.spec.id === id);

const getBundledLogo = (id: string): string | undefined => BUNDLED_LOGOS[id];

export {
  BUNDLED_TEMPLATES,
  BUNDLED_INDEX,
  BUNDLED_LOGOS,
  getBundledTemplate,
  getBundledLogo,
};
