/**
 * Emits the blueprint contract as JSON Schema, derived from the Zod schema.
 *
 * Blueprints live in their own repository (`deploykithq/deploykit-templates`),
 * which has no dependency on this monorepo — its CI validates contributions, and
 * contributors' editors autocomplete them, against the schema file it carries.
 * That file is generated here so there is still only one definition of what a
 * blueprint is: `templateSpecSchema`.
 *
 * Run it whenever the Zod schema changes, and commit the result there:
 *
 *   pnpm --filter @deploykit/shared schema:emit -- --out ../../../deploykit-templates/schema/template.schema.json
 *
 * `--schema game` emits the game server definition contract (`gameSpecSchema`)
 * instead:
 *
 *   pnpm --filter @deploykit/shared schema:emit -- --schema game --out ../../../deploykit-templates/schema/game.schema.json
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

import { zodToJsonSchema } from "zod-to-json-schema";

import { gameSpecSchema } from "../src/games/game.schema";
import { templateSpecSchema } from "../src/templates/template.schema";

const SCHEMA_BASE =
  "https://raw.githubusercontent.com/deploykithq/deploykit-templates/master/schema";

const TARGETS = {
  template: {
    schema: templateSpecSchema,
    file: "template.schema.json",
    title: "DeployKit blueprint",
    description:
      "A one-click template: metadata, generated variables, routing, environment and config files. Never contains a secret — it declares how one is derived.",
  },
  game: {
    schema: gameSpecSchema,
    file: "game.schema.json",
    title: "DeployKit game server",
    description:
      "A game server definition: image, ports, user-configurable variables, volumes, console and backup behaviour. Never contains a secret — it declares how one is derived.",
  },
} as const;

const schemaFlag = process.argv.indexOf("--schema");
const targetName = (
  schemaFlag !== -1 ? process.argv[schemaFlag + 1] : "template"
) as keyof typeof TARGETS;
const target = TARGETS[targetName];
if (!target) {
  console.error(`[shared] Unknown --schema "${targetName}" (template | game)`);
  process.exit(1);
}

const outFlag = process.argv.indexOf("--out");
const out =
  outFlag !== -1 && process.argv[outFlag + 1]
    ? path.resolve(process.argv[outFlag + 1]!)
    : path.resolve(target.file);

const derived = zodToJsonSchema(target.schema, {
  name: undefined,
  $refStrategy: "none",
  target: "jsonSchema7",
}) as Record<string, any>;

// The Zod schema closes the object, so the `"$schema"` line that makes an
// editor validate the file would itself be a validation error. Zod drops the
// key when the API parses a blueprint; permit it here so authoring works.
derived.properties = {
  $schema: {
    type: "string",
    description: "Editor hint. Ignored by DeployKit.",
  },
  ...derived.properties,
};

const jsonSchema = {
  $id: `${SCHEMA_BASE}/${target.file}`,
  ...derived,
  title: target.title,
  description: target.description,
};

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(jsonSchema, null, 2) + "\n");

console.log(`[shared] Wrote the ${targetName} JSON Schema to ${out}`);
