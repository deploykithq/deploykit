/**
 * Turns `blueprints/<id>/` directories into a TypeScript module.
 *
 * The bundled catalogue is inlined into `src/generated.ts` rather than read
 * from disk at runtime: the API image is built by `tsc` and installed with
 * `pnpm install --prod`, neither of which is obliged to carry a package's
 * non-source directories. Inlining removes any question of what shipped.
 *
 * The same walk emits `index.json` — the file the public catalogue repository
 * serves so the Templates page can list blueprints without fetching each one.
 *
 * Run with `pnpm --filter @deploykit/templates generate`.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { templateSpecSchema, type TemplateMetaT } from "@deploykit/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const blueprintsDir = path.join(root, "blueprints");

interface LoadedBlueprintI {
  spec: unknown;
  compose: string;
  logo?: string;
}

const loadBlueprint = (id: string): LoadedBlueprintI => {
  const dir = path.join(blueprintsDir, id);
  const specPath = path.join(dir, "template.json");
  const composePath = path.join(dir, "docker-compose.yml");

  if (!existsSync(specPath))
    throw new Error(`${id}: missing template.json`);
  if (!existsSync(composePath))
    throw new Error(`${id}: missing docker-compose.yml`);

  const parsed = templateSpecSchema.safeParse(
    JSON.parse(readFileSync(specPath, "utf8")),
  );
  if (!parsed.success) {
    throw new Error(
      `${id}: invalid template.json — ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  if (parsed.data.id !== id) {
    // The directory name is the catalogue URL segment; a mismatch would make
    // `getTemplate(id)` fetch a blueprint that calls itself something else.
    throw new Error(
      `${id}: template.json declares id "${parsed.data.id}" but lives in blueprints/${id}`,
    );
  }

  const logoName = parsed.data.logo;
  const logoPath = logoName ? path.join(dir, logoName) : undefined;
  if (logoPath && !existsSync(logoPath)) {
    throw new Error(`${id}: declares logo "${logoName}" but the file is missing`);
  }

  return {
    spec: parsed.data,
    compose: readFileSync(composePath, "utf8"),
    logo: logoPath ? readFileSync(logoPath, "utf8") : undefined,
  };
};

const ids = readdirSync(blueprintsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

if (ids.length === 0) throw new Error("No blueprints found");

const blueprints = ids.map((id) => ({ id, ...loadBlueprint(id) }));
const index: TemplateMetaT[] = blueprints.map(({ spec }) => {
  const s = spec as TemplateMetaT;
  return {
    id: s.id,
    name: s.name,
    version: s.version,
    description: s.description,
    ...(s.logo ? { logo: s.logo } : {}),
    links: s.links,
    tags: s.tags,
  };
});

const generated = `// GENERATED FILE — do not edit.
// Run \`pnpm --filter @deploykit/templates generate\` after changing blueprints/.
import type { TemplateT } from "@deploykit/shared";

const BUNDLED_TEMPLATES: TemplateT[] = ${JSON.stringify(
  blueprints.map(({ spec, compose }) => ({ spec, compose })),
  null,
  2,
)};

/** Blueprint logos, keyed by template id, as raw SVG markup. */
const BUNDLED_LOGOS: Record<string, string> = ${JSON.stringify(
  Object.fromEntries(
    blueprints.filter((b) => b.logo).map((b) => [b.id, b.logo]),
  ),
  null,
  2,
)};

export { BUNDLED_TEMPLATES, BUNDLED_LOGOS };
`;

writeFileSync(path.join(root, "src", "generated.ts"), generated);
writeFileSync(
  path.join(root, "index.json"),
  JSON.stringify(index, null, 2) + "\n",
);

console.log(
  `[templates] Generated ${blueprints.length} blueprint(s): ${ids.join(", ")}`,
);
