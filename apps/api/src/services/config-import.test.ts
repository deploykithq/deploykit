import { describe, expect, it } from "vitest";

import {
  CONFIG_MANIFEST_KIND,
  configManifestSchema,
  SECRETS_MANIFEST_KIND,
  secretsManifestSchema,
} from "@deploykit/shared";

import { ManifestParseError, parseManifest, planImport } from "./config-import";

import type { ConfigManifestI, SecretsManifestI } from "@deploykit/shared";
import type { InstanceIndexI } from "./config-import";

/**
 * The planner, exercised without a database: every fact about the instance
 * arrives in the index, which is the whole reason it is shaped that way.
 */

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const SERVER_ID = "33333333-3333-3333-3333-333333333333";
const APP_ID = "44444444-4444-4444-4444-444444444444";

const emptyIndex = (over: Partial<InstanceIndexI> = {}): InstanceIndexI => ({
  projects: [],
  applications: [],
  databases: [],
  stacks: [],
  routedDomains: [],
  statusPageSlugs: [],
  servers: [],
  users: [],
  members: [],
  ...over,
});

const manifest = (projects: unknown[]): ConfigManifestI =>
  configManifestSchema.parse({
    version: 1,
    kind: CONFIG_MANIFEST_KIND,
    projects,
  });

const secretsDoc = (projects: unknown[]): SecretsManifestI =>
  secretsManifestSchema.parse({
    version: 1,
    kind: SECRETS_MANIFEST_KIND,
    projects,
  });

const app = (over: Record<string, unknown> = {}) => ({
  name: "api",
  sourceType: "github",
  repositoryUrl: "https://github.com/acme/api",
  ...over,
});

const plan = (
  projects: unknown[],
  index: InstanceIndexI = emptyIndex(),
  opts: {
    secrets?: SecretsManifestI | null;
    onMissingServer?: "fail" | "local";
  } = {},
) =>
  planImport({
    manifest: manifest(projects),
    secrets: opts.secrets ?? null,
    index,
    onMissingServer: opts.onMissingServer ?? "fail",
  });

const item = (result: ReturnType<typeof plan>, kind: string, path: string) =>
  result.plan.items.find((i) => i.kind === kind && i.path === path);

describe("planImport", () => {
  it("creates everything on an empty instance", () => {
    const result = plan([
      {
        name: "acme",
        applications: [app({ domains: [{ domain: "api.acme.io", port: 3000 }] })],
        databases: [{ name: "acme-db", type: "postgresql", internalPort: 5432 }],
      },
    ]);

    expect(item(result, "project", "acme")?.action).toBe("create");
    expect(item(result, "application", "acme / api")?.action).toBe("create");
    expect(item(result, "database", "acme / acme-db")?.action).toBe("create");
    expect(item(result, "domain", "acme / api / api.acme.io")?.action).toBe(
      "create",
    );
    expect(result.plan.counts.error).toBe(0);
    expect(result.ops).toHaveLength(1);
  });

  it("descends into a project that already exists", () => {
    const result = plan(
      [{ name: "acme", applications: [app({ name: "worker" })] }],
      emptyIndex({ projects: [{ id: PROJECT_ID, name: "acme" }] }),
    );

    expect(item(result, "project", "acme")?.action).toBe("skip-exists");
    expect(item(result, "application", "acme / worker")?.action).toBe("create");
    expect(result.ops[0]!.existingId).toBe(PROJECT_ID);
  });

  it("leaves an application that already exists completely alone", () => {
    const result = plan(
      [
        {
          name: "acme",
          applications: [
            app({ domains: [{ domain: "new.acme.io", port: 3000 }] }),
          ],
        },
      ],
      emptyIndex({
        projects: [{ id: PROJECT_ID, name: "acme" }],
        applications: [{ id: APP_ID, projectId: PROJECT_ID, name: "api" }],
      }),
    );

    expect(item(result, "application", "acme / api")?.action).toBe("skip-exists");
    // Its domains are not planned: adding routing to a running service would
    // be a change to that service, not a missing resource.
    expect(item(result, "domain", "acme / api / new.acme.io")).toBeUndefined();
    expect(result.ops[0]!.applications).toHaveLength(0);
  });

  it("refuses to guess when two projects share a name", () => {
    const result = plan(
      [{ name: "acme", applications: [app()] }],
      emptyIndex({
        projects: [
          { id: PROJECT_ID, name: "acme" },
          { id: USER_ID, name: "acme" },
        ],
      }),
    );

    expect(item(result, "project", "acme")?.action).toBe("error");
    expect(item(result, "project", "acme")?.reason).toContain("rename one");
    expect(result.ops).toHaveLength(0);
  });

  it("imports a project without its status page when the slug is taken", () => {
    const result = plan(
      [{ name: "acme", statusPage: { enabled: true, slug: "blog" } }],
      emptyIndex({
        projects: [{ id: USER_ID, name: "other" }],
        statusPageSlugs: [{ projectId: USER_ID, slug: "blog" }],
      }),
    );

    expect(result.ops[0]!.statusPage).toEqual({
      enabled: false,
      slug: null,
      title: null,
    });
    expect(result.plan.warnings.join(" ")).toContain("already in use");
  });

  it("flags a container name another project already uses", () => {
    const result = plan(
      [{ name: "acme", applications: [app()] }],
      emptyIndex({
        projects: [{ id: USER_ID, name: "legacy" }],
        applications: [{ id: APP_ID, projectId: USER_ID, name: "api" }],
      }),
    );

    expect(item(result, "application", "acme / api")?.action).toBe("create");
    expect(result.plan.containerNameConflicts).toEqual([
      {
        kind: "application",
        containerName: "dk-api",
        importingInto: "acme",
        alreadyUsedBy: "project legacy / application api",
      },
    ]);
  });

  it("skips a hostname that is already routed", () => {
    const result = plan(
      [
        {
          name: "acme",
          applications: [app({ domains: [{ domain: "api.acme.io", port: 3000 }] })],
        },
      ],
      emptyIndex({ routedDomains: ["api.acme.io"] }),
    );

    expect(item(result, "domain", "acme / api / api.acme.io")?.action).toBe(
      "skip-exists",
    );
    expect(result.ops[0]!.applications[0]!.domains).toHaveLength(0);
  });

  it("stops on a server it cannot find, unless told to fall back to local", () => {
    const projects = [{ name: "acme", applications: [app({ server: "vps-2" })] }];

    const strict = plan(projects, emptyIndex());
    expect(item(strict, "application", "acme / api")?.action).toBe("error");
    expect(item(strict, "application", "acme / api")?.reason).toContain("vps-2");

    const lenient = plan(projects, emptyIndex(), { onMissingServer: "local" });
    expect(item(lenient, "application", "acme / api")?.action).toBe("create");
    expect(lenient.ops[0]!.applications[0]!.serverId).toBeNull();
    expect(lenient.plan.warnings.join(" ")).toContain("local host");
  });

  it("resolves a server by name", () => {
    const result = plan(
      [{ name: "acme", applications: [app({ server: "prod-eu-1" })] }],
      emptyIndex({ servers: [{ id: SERVER_ID, name: "prod-eu-1" }] }),
    );
    expect(result.ops[0]!.applications[0]!.serverId).toBe(SERVER_ID);
  });

  it("never creates a user, and never changes an existing membership", () => {
    const result = plan(
      [
        {
          name: "acme",
          members: [
            { email: "ghost@acme.io", role: "operator" },
            { email: "boss@acme.io", role: "viewer" },
            { email: "dev@acme.io", role: "admin" },
            { email: "new@acme.io", role: "operator" },
          ],
        },
      ],
      emptyIndex({
        projects: [{ id: PROJECT_ID, name: "acme" }],
        users: [
          { id: "u-boss", email: "boss@acme.io", role: "admin" },
          { id: USER_ID, email: "dev@acme.io", role: "operator" },
          { id: "u-new", email: "new@acme.io", role: "viewer" },
        ],
        members: [{ projectId: PROJECT_ID, userId: USER_ID }],
      }),
    );

    expect(item(result, "member", "acme / ghost@acme.io")?.reason).toContain(
      "no user",
    );
    expect(item(result, "member", "acme / boss@acme.io")?.reason).toContain(
      "global admins",
    );
    expect(item(result, "member", "acme / dev@acme.io")?.action).toBe(
      "skip-exists",
    );
    expect(item(result, "member", "acme / new@acme.io")?.action).toBe("create");
    expect(result.ops[0]!.members).toEqual([
      { userId: "u-new", role: "operator" },
    ]);
  });

  it("rejects a cron the scheduler could not run", () => {
    const result = plan([
      {
        name: "acme",
        applications: [
          app({
            tasks: [{ name: "migrate", command: "echo hi", cron: "not a cron" }],
          }),
        ],
      },
    ]);

    expect(item(result, "task", "acme / api / migrate")?.action).toBe("error");
    expect(item(result, "application", "acme / api")?.action).toBe("error");
    expect(result.ops[0]!.applications).toHaveLength(0);
  });

  it("rejects a stack routing or task that names a service the file lacks", () => {
    const result = plan([
      {
        name: "acme",
        stacks: [
          {
            name: "n8n",
            composeFile: "services:\n  n8n:\n    image: n8nio/n8n\n",
            domains: [{ serviceName: "web", domain: "n8n.acme.io", port: 5678 }],
            tasks: [
              { name: "prune", command: "echo hi", serviceName: "worker" },
            ],
          },
        ],
      },
    ]);

    expect(item(result, "domain", "acme / n8n / n8n.acme.io")?.reason).toContain(
      'no service "web"',
    );
    expect(item(result, "task", "acme / n8n / prune")?.reason).toContain(
      'no service "worker"',
    );
    expect(item(result, "stack", "acme / n8n")?.action).toBe("error");
  });

  it("rejects a Compose file that is not a stack", () => {
    const result = plan([
      { name: "acme", stacks: [{ name: "n8n", composeFile: "nope: true\n" }] },
    ]);
    expect(item(result, "stack", "acme / n8n")?.action).toBe("error");
  });

  it("reports withheld values the secrets file does not supply", () => {
    const result = plan([
      {
        name: "acme",
        applications: [
          app({
            env: { NODE_ENV: "production" },
            withheldSecrets: ["JWT_SECRET", "sourceToken"],
          }),
        ],
        databases: [
          {
            name: "acme-db",
            type: "postgresql",
            internalPort: 5432,
            withheldSecrets: ["password"],
          },
        ],
      },
    ]);

    expect(result.plan.missingSecrets).toEqual([
      "acme / api: JWT_SECRET",
      "acme / api: sourceToken",
      "acme / acme-db: password",
    ]);
    expect(result.plan.secretsProvided).toBe(false);
    // A database still gets a password, or its container could never start.
    expect(result.ops[0]!.databases[0]!.passwordSource).toBe("generate");
  });

  it("merges the secrets file into what will be written", () => {
    const result = plan(
      [
        {
          name: "acme",
          applications: [
            app({
              env: { NODE_ENV: "production" },
              withheldSecrets: ["JWT_SECRET", "sourceToken"],
            }),
          ],
          databases: [
            {
              name: "acme-db",
              type: "postgresql",
              internalPort: 5432,
              withheldSecrets: ["password"],
            },
          ],
        },
      ],
      emptyIndex(),
      {
        secrets: secretsDoc([
          {
            name: "acme",
            applications: [
              {
                name: "api",
                env: { JWT_SECRET: "abc" },
                sourceToken: "ghp_abc",
              },
            ],
            databases: [{ name: "acme-db", password: "restored" }],
          },
        ]),
      },
    );

    expect(result.plan.missingSecrets).toEqual([]);
    expect(result.ops[0]!.applications[0]!.env).toEqual({
      NODE_ENV: "production",
      JWT_SECRET: "abc",
    });
    expect(result.ops[0]!.applications[0]!.sourceToken).toBe("ghp_abc");
    expect(result.ops[0]!.databases[0]!.passwordSource).toBe("provided");
    expect(result.ops[0]!.databases[0]!.password).toBe("restored");
  });

  it("does not mint a password for redis, which has none", () => {
    const result = plan([
      {
        name: "acme",
        databases: [{ name: "cache", type: "redis", internalPort: 6379 }],
      },
    ]);
    expect(result.ops[0]!.databases[0]!.passwordSource).toBe("none");
  });

  it("writes an empty mount rather than none when its contents are missing", () => {
    const result = plan([
      {
        name: "acme",
        stacks: [
          {
            name: "n8n",
            composeFile: "services:\n  n8n:\n    image: n8nio/n8n\n",
            mounts: [{ filePath: "config/n8n.json" }],
            withheldSecrets: ["mount:config/n8n.json"],
          },
        ],
      },
    ]);

    // A missing bind source arrives as an empty directory, which is worse.
    expect(result.ops[0]!.stacks[0]!.mounts).toEqual([
      { filePath: "config/n8n.json", content: "" },
    ]);
    expect(result.plan.missingSecrets).toEqual([
      "acme / n8n: mount:config/n8n.json",
    ]);
  });
});

describe("parseManifest", () => {
  it("says so when the secrets file was uploaded instead", () => {
    expect(() =>
      parseManifest(`version: 1\nkind: ${SECRETS_MANIFEST_KIND}\nprojects: []\n`),
    ).toThrow(ManifestParseError);
    expect(() =>
      parseManifest(`version: 1\nkind: ${SECRETS_MANIFEST_KIND}\nprojects: []\n`),
    ).toThrow(/instance-secrets/);
  });

  it("names the unsupported version", () => {
    expect(() =>
      parseManifest(`version: 9\nkind: ${CONFIG_MANIFEST_KIND}\nprojects: []\n`),
    ).toThrow(/version 9/);
  });

  it("rejects a duplicate key instead of silently taking the last one", () => {
    expect(() =>
      parseManifest(
        `version: 1\nkind: ${CONFIG_MANIFEST_KIND}\nprojects: []\nprojects: []\n`,
      ),
    ).toThrow(ManifestParseError);
  });

  it("rejects something that is not a manifest at all", () => {
    expect(() => parseManifest("- 1\n- 2\n")).toThrow(/not a YAML mapping/);
    expect(() => parseManifest("a: [unclosed\n")).toThrow(/Invalid YAML/);
  });
});
