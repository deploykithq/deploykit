import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";

import {
  resolveTemplateSpec,
  resolveVariables,
  substitute,
  TemplateVariableError,
} from "./template-variables";

import type { TemplateSpecT } from "@deploykit/shared";

const CTX = { domain: "app.example.com" };

/** A minimal valid spec; each test overrides only what it exercises. */
const spec = (partial: Partial<TemplateSpecT> = {}): TemplateSpecT => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  description: "Demo blueprint",
  links: {},
  tags: [],
  variables: {},
  domains: [],
  env: {},
  mounts: [],
  ...partial,
});

describe("resolveVariables — helpers", () => {
  it("resolves ${domain} to the deployment's domain", () => {
    expect(resolveVariables({ d: "${domain}" }, CTX)).toEqual({
      d: "app.example.com",
    });
  });

  it("generates a password of the requested length, alphanumeric only", () => {
    const { p } = resolveVariables({ p: "${password:32}" }, CTX);
    expect(p).toHaveLength(32);
    expect(p).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("defaults ${password} to 16 characters", () => {
    expect(resolveVariables({ p: "${password}" }, CTX).p).toHaveLength(16);
  });

  it("generates base64 of the requested byte count", () => {
    const { b } = resolveVariables({ b: "${base64:64}" }, CTX);
    // 64 bytes → 88 base64 chars (with padding).
    expect(Buffer.from(b!, "base64")).toHaveLength(64);
  });

  it("generates hex of the requested byte count", () => {
    const { h } = resolveVariables({ h: "${hash:16}" }, CTX);
    expect(h).toMatch(/^[a-f0-9]{32}$/);
  });

  it("generates a v4 uuid", () => {
    const { u } = resolveVariables({ u: "${uuid}" }, CTX);
    expect(u).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("generates a port in the ephemeral range", () => {
    const { p } = resolveVariables({ p: "${randomPort}" }, CTX);
    const port = Number(p);
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).toBeLessThanOrEqual(65_000);
  });

  it("generates a username and an email on the deployment domain", () => {
    const { u, e } = resolveVariables(
      { u: "${username}", e: "${email}" },
      CTX,
    );
    expect(u).toMatch(/^[a-z0-9-]+$/);
    expect(e).toMatch(/^[a-z0-9-]+@app\.example\.com$/);
  });

  it("generates an ISO-8601 timestamp", () => {
    const { t } = resolveVariables({ t: "${timestamp}" }, CTX);
    expect(new Date(t!).toString()).not.toBe("Invalid Date");
  });

  it("passes literals through untouched", () => {
    expect(resolveVariables({ a: "plain value" }, CTX)).toEqual({
      a: "plain value",
    });
  });
});

describe("resolveVariables — ${jwt}", () => {
  it("signs with an already-resolved variable, whatever the declaration order", () => {
    // `token` is declared *before* the secret it depends on: the second pass is
    // what makes this work, and ordering must not matter to blueprint authors.
    const resolved = resolveVariables(
      { token: "${jwt:secret:anon}", secret: "${base64:32}" },
      CTX,
    );

    const payload = jwt.verify(resolved.token!, resolved.secret!) as Record<
      string,
      unknown
    >;
    expect(payload.role).toBe("anon");
    expect(payload.iss).toBe("deploykit");
  });

  it("omits role when none is given", () => {
    const resolved = resolveVariables(
      { secret: "${base64:32}", token: "${jwt:secret}" },
      CTX,
    );
    const payload = jwt.verify(resolved.token!, resolved.secret!) as Record<
      string,
      unknown
    >;
    expect(payload.role).toBeUndefined();
  });

  it("rejects a jwt that references an unknown variable", () => {
    expect(() => resolveVariables({ t: "${jwt:nope}" }, CTX)).toThrow(
      TemplateVariableError,
    );
  });

  it("rejects a jwt that references another jwt", () => {
    // Second-pass values are not available to other second-pass entries, so
    // this would silently sign with `undefined` if it were allowed.
    expect(() =>
      resolveVariables({ a: "${jwt:b}", b: "${jwt:a}" }, CTX),
    ).toThrow(TemplateVariableError);
  });
});

describe("resolveVariables — errors", () => {
  it("rejects an unknown helper", () => {
    expect(() => resolveVariables({ x: "${nosuchhelper}" }, CTX)).toThrow(
      TemplateVariableError,
    );
  });

  it("rejects a non-numeric helper argument", () => {
    expect(() => resolveVariables({ x: "${password:abc}" }, CTX)).toThrow(
      TemplateVariableError,
    );
  });

  it("rejects an out-of-range helper argument", () => {
    expect(() => resolveVariables({ x: "${password:9999}" }, CTX)).toThrow(
      TemplateVariableError,
    );
  });
});

describe("substitute", () => {
  it("replaces every occurrence of a reference", () => {
    expect(substitute("${a}/${b}/${a}", { a: "1", b: "2" })).toBe("1/2/1");
  });

  it("throws on a reference that was never declared", () => {
    expect(() => substitute("${missing}", { a: "1" })).toThrow(
      TemplateVariableError,
    );
  });

  it("treats $${ as an escaped literal ${", () => {
    // Compose files and shell-style defaults legitimately contain `${...}`.
    expect(substitute("$${NOT_OURS}", {})).toBe("${NOT_OURS}");
  });
});

describe("resolveTemplateSpec", () => {
  const analytics = spec({
    variables: {
      main_domain: "${domain}",
      secret_key_base: "${base64:64}",
      db_password: "${password:24}",
    },
    domains: [{ service: "app", port: 8000, host: "${main_domain}" }],
    env: {
      BASE_URL: "https://${main_domain}",
      SECRET_KEY_BASE: "${secret_key_base}",
      POSTGRES_PASSWORD: "${db_password}",
    },
    mounts: [{ filePath: "app.conf", content: "host = ${main_domain}" }],
  });

  it("substitutes resolved values into domains, env and mounts", () => {
    const out = resolveTemplateSpec(analytics, CTX);

    expect(out.domains[0]!.host).toBe("app.example.com");
    expect(out.env.BASE_URL).toBe("https://app.example.com");
    expect(out.env.SECRET_KEY_BASE).toBe(out.variables.secret_key_base);
    expect(out.mounts[0]!.content).toBe("host = app.example.com");
  });

  it("reports which values are secret so the UI can reveal them once", () => {
    const out = resolveTemplateSpec(analytics, CTX);

    expect(out.secrets).toHaveProperty("secret_key_base");
    expect(out.secrets).toHaveProperty("db_password");
    // A domain is not a credential — showing it as one is noise.
    expect(out.secrets).not.toHaveProperty("main_domain");
  });

  it("never repeats a generated secret across two resolutions", () => {
    const a = resolveTemplateSpec(analytics, CTX);
    const b = resolveTemplateSpec(analytics, CTX);

    expect(a.variables.secret_key_base).not.toBe(b.variables.secret_key_base);
    expect(a.variables.db_password).not.toBe(b.variables.db_password);
  });

  it("fails loudly when env references a variable that was never declared", () => {
    expect(() =>
      resolveTemplateSpec(spec({ env: { X: "${typo}" } }), CTX),
    ).toThrow(TemplateVariableError);
  });
});
