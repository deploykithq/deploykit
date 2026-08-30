import { describe, it, expect } from "vitest";
import { parse } from "yaml";

import { BUNDLED_TEMPLATES } from "@deploykit/templates";
import { templateSpecSchema } from "@deploykit/shared";

import { resolveTemplateSpec } from "./template-variables";
import { transformCompose, listComposeServices } from "./compose";

/**
 * Contract tests for the bundled catalogue.
 *
 * Every blueprint is walked through the exact pipeline a deployment uses —
 * validate, resolve variables, transform the Compose file — so an authoring
 * mistake fails here rather than at `docker compose up` on someone's server.
 */

const CTX = { domain: "example-stack.deploykit.test" };

/**
 * `${VAR}` references Compose will try to interpolate from the .env file.
 *
 * Walks the parsed document rather than the raw text, because that is what
 * Compose itself interpolates: it parses the YAML first, so a `${...}` inside a
 * comment is not a reference and must not be reported as a missing variable.
 */
const composeVariableRefs = (composeFile: string): string[] => {
  const found = new Set<string>();

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      // `$$FOO` is Compose's own escape for a literal `$FOO`; not a reference.
      for (const match of node.matchAll(
        /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}/g,
      )) {
        found.add(match[1]!);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };

  visit(parse(composeFile));
  return [...found];
};

it("bundles at least the migrated catalogue", () => {
  expect(BUNDLED_TEMPLATES.length).toBeGreaterThanOrEqual(18);
});

describe.each(BUNDLED_TEMPLATES.map((t) => [t.spec.id, t] as const))(
  "blueprint %s",
  (id, template) => {
    it("has a spec that satisfies the schema", () => {
      expect(templateSpecSchema.safeParse(template.spec).success).toBe(true);
    });

    it("has a parseable Compose file with at least one service", () => {
      expect(listComposeServices(template.compose).length).toBeGreaterThan(0);
    });

    it("routes only to services the Compose file defines", () => {
      const services = listComposeServices(template.compose);
      for (const d of template.spec.domains) {
        expect(services).toContain(d.service);
      }
    });

    it("declares every variable its env and domains reference", () => {
      // resolveTemplateSpec throws on an undeclared `${name}`.
      expect(() => resolveTemplateSpec(template.spec, CTX)).not.toThrow();
    });

    it("supplies every ${VAR} the Compose file interpolates", () => {
      // The gap this catches: a Compose file reading ${FOO} that template.json
      // never puts in `env`. Compose substitutes an empty string and the
      // container starts misconfigured instead of failing.
      const resolved = resolveTemplateSpec(template.spec, CTX);
      const missing = composeVariableRefs(template.compose).filter(
        (name) => !(name in resolved.env),
      );
      expect(missing).toEqual([]);
    });

    it("produces a Compose file DeployKit can deploy", () => {
      const resolved = resolveTemplateSpec(template.spec, CTX);
      const out = transformCompose({
        composeServiceId: "11111111-1111-4111-8111-111111111111",
        projectId: "22222222-2222-4222-8222-222222222222",
        stackName: id,
        composeFile: template.compose,
        domains: resolved.domains.map((d) => ({
          serviceName: d.service,
          domain: d.host,
          port: d.port,
          https: true,
          path: d.path ?? null,
          certificateResolver: "letsencrypt",
        })),
      });

      const doc = parse(out);
      for (const service of Object.values<any>(doc.services)) {
        expect(service.labels["deploykit.service"]).toBe(
          "11111111-1111-4111-8111-111111111111",
        );
        // A fixed container_name would collide across two deployments of the
        // same blueprint; the transformer must have stripped any.
        expect(service.container_name).toBeUndefined();
      }

      for (const d of resolved.domains) {
        expect(doc.services[d.service].labels["traefik.enable"]).toBe("true");
      }
    });

    it("never ships a literal credential in place of a generated one", () => {
      const serialized = JSON.stringify(template.spec);
      expect(serialized).not.toMatch(/change[-_]?me/i);
      expect(serialized).not.toMatch(/password"\s*:\s*"(admin|secret|1234)/i);
    });
  },
);
