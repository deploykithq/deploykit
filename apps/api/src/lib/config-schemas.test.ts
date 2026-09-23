import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  CONFIG_MANIFEST_KIND,
  configManifestSchema,
  isSecretEnvVar,
  splitEnvSecrets,
} from "@deploykit/shared";

/**
 * The manifest contract and the secret classifier.
 *
 * The classifier is the security-critical half: a false negative writes a
 * credential into a file meant for git, so both directions are asserted
 * explicitly rather than spot-checked.
 */

const WITHHELD: Array<[string, string, string]> = [
  ["JWT_SECRET", "anything", "the name says secret"],
  ["STRIPE_SECRET_KEY", "sk_live_abc123", "the name says secret and key"],
  ["DB_PASSWORD", "hunter2", "the name says password"],
  ["MYSQL_PWD", "hunter2", "abbreviated password"],
  ["SUPABASE_SERVICE_ROLE_KEY", "abc", "the name says key"],
  ["GITHUB_TOKEN", "abc", "the name says token"],
  ["SESSION_SALT", "abc", "the name says salt"],
  ["SENTRY_DSN", "https://abc@o1.ingest.sentry.io/1", "a DSN is a credential"],
  [
    "DATABASE_URL",
    "postgres://admin:pw@db:5432/acme",
    "the value carries credentials",
  ],
  [
    "BLOB",
    "-----BEGIN PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----",
    "the value is a private key",
  ],
  [
    "ANON",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
    "the value is a JWT",
  ],
  ["MAILER", "SG.abcdefghijklmnop", "the value has a known token prefix"],
  [
    "ADMIN_CODE",
    "aB3dEf7hJk2mNp5qRs8tUv1wXy4zAb6C",
    "the value looks generated",
  ],
];

const KEPT: Array<[string, string, string]> = [
  ["NODE_ENV", "production", "an ordinary setting"],
  ["PORT", "3000", "an ordinary setting"],
  ["LOG_LEVEL", "debug", "an ordinary setting"],
  ["WEB_URL", "https://app.example.com", "a URL with no credentials"],
  [
    "NEXT_PUBLIC_API_URL",
    "https://api.example.com/v1",
    "a public URL is exactly what a manifest is for",
  ],
  ["REDIS_HOST", "redis", "a hostname is not a credential"],
  ["SENTRY_ENVIRONMENT", "production", "not the DSN itself"],
  [
    "WELCOME_MESSAGE",
    "Hello there and welcome to the application",
    "long, but it has whitespace",
  ],
  [
    "SITE_URI",
    "https://status.example.com/a/rather/long/path?with=query",
    "long, but it is a URL",
  ],
];

describe("isSecretEnvVar", () => {
  for (const [key, value, why] of WITHHELD)
    it(`withholds ${key} — ${why}`, () => {
      expect(isSecretEnvVar(key, value)).toBe(true);
    });

  for (const [key, value, why] of KEPT)
    it(`keeps ${key} — ${why}`, () => {
      expect(isSecretEnvVar(key, value)).toBe(false);
    });
});

describe("splitEnvSecrets", () => {
  it("splits, sorts and reports the withheld keys", () => {
    const split = splitEnvSecrets({
      PORT: "3000",
      JWT_SECRET: "abc",
      NODE_ENV: "production",
      API_TOKEN: "xyz",
    });

    expect(split.env).toEqual({ NODE_ENV: "production", PORT: "3000" });
    expect(split.secrets).toEqual({ API_TOKEN: "xyz", JWT_SECRET: "abc" });
    expect(split.withheld).toEqual(["API_TOKEN", "JWT_SECRET"]);
  });

  it("is stable regardless of insertion order, so re-exports do not churn", () => {
    const a = splitEnvSecrets({ B: "2", A: "1", C: "3" });
    const b = splitEnvSecrets({ C: "3", A: "1", B: "2" });
    expect(Object.keys(a.env)).toEqual(Object.keys(b.env));
  });

  it("keeps an empty value even under a secret-looking name", () => {
    expect(splitEnvSecrets({ EMPTY_TOKEN: "" }).withheld).toEqual([
      "EMPTY_TOKEN",
    ]);
  });
});

const minimal = {
  version: 1,
  kind: CONFIG_MANIFEST_KIND,
  projects: [{ name: "acme" }],
};

describe("configManifestSchema", () => {
  it("accepts a minimal document", () => {
    expect(configManifestSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects another version", () => {
    expect(
      configManifestSchema.safeParse({ ...minimal, version: 2 }).success,
    ).toBe(false);
  });

  it("rejects the secrets document", () => {
    expect(
      configManifestSchema.safeParse({
        ...minimal,
        kind: "deploykit/instance-secrets",
      }).success,
    ).toBe(false);
  });

  it("drops keys it does not know, so nothing unexpected reaches an insert", () => {
    const parsed = configManifestSchema.parse({
      ...minimal,
      projects: [{ name: "acme", __proto__x: "nope", id: "guessed" }],
    });
    expect(parsed.projects[0]).not.toHaveProperty("id");
    expect(parsed.projects[0]).not.toHaveProperty("__proto__x");
  });

  it("rejects an env var name Compose could not interpolate", () => {
    const result = configManifestSchema.safeParse({
      ...minimal,
      projects: [
        {
          name: "acme",
          applications: [
            { name: "api", sourceType: "github", env: { "not-a-name": "x" } },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("survives a YAML round trip", () => {
    const parsed = configManifestSchema.parse({
      ...minimal,
      projects: [
        {
          name: "acme",
          applications: [
            {
              name: "api",
              sourceType: "github",
              repositoryUrl: "https://github.com/acme/api",
              env: { NODE_ENV: "production" },
              domains: [{ domain: "api.acme.io", port: 3000 }],
            },
          ],
          stacks: [
            {
              name: "n8n",
              composeFile: "services:\n  n8n:\n    image: n8nio/n8n\n",
            },
          ],
        },
      ],
    });

    const roundTripped = configManifestSchema.parse(parse(stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });
});
