import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { stringify } from "yaml";

import {
  applications,
  composeDomains,
  composeServices,
  databases,
  domains,
  projectMembers,
  projects,
  scheduledTasks,
} from "../db/schema/index";
import {
  buildManifest,
  EXCLUDED_COLUMNS,
  MANIFEST_COLUMNS,
  toApplicationValues,
} from "./config-manifest";

import type {
  ApplicationT,
  ComposeDomainT,
  ComposeServiceT,
  DatabaseT,
  DomainT,
  ProjectT,
  ScheduledTaskT,
} from "../db/schema/index";
import type { ProjectExportI } from "./config-manifest";

const NOW = new Date("2026-09-23T10:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const APP_ID = "22222222-2222-2222-2222-222222222222";
const DB_ID = "33333333-3333-3333-3333-333333333333";
const STACK_ID = "44444444-4444-4444-4444-444444444444";
const SERVER_ID = "55555555-5555-5555-5555-555555555555";

/** What AES-256-GCM output looks like: iv:authTag:ciphertext, all hex. */
const CIPHERTEXT = `${"a".repeat(32)}:${"b".repeat(32)}:${"c".repeat(64)}`;
const CIPHERTEXT_PATTERN = /[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+/;

const projectRow = (over: Partial<ProjectT> = {}): ProjectT => ({
  id: PROJECT_ID,
  name: "acme",
  description: "Production workloads",
  statusPageEnabled: true,
  statusPageSlug: "acme",
  statusPageTitle: "Acme status",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const appRow = (over: Partial<ApplicationT> = {}): ApplicationT => ({
  id: APP_ID,
  projectId: PROJECT_ID,
  name: "api",
  sourceType: "github",
  repositoryUrl: "https://github.com/acme/api",
  branch: "main",
  sourceToken: CIPHERTEXT,
  rootDirectory: "services/api",
  webhookSecret: CIPHERTEXT,
  buildType: "nixpacks",
  dockerfilePath: "./Dockerfile",
  buildArgs: { NODE_VERSION: "20", NPM_TOKEN: "npm_deadbeefdeadbeef" },
  startCommand: "node dist/main.js",
  envVars: CIPHERTEXT,
  volumes: ["api-uploads:/app/uploads"],
  port: 3000,
  cpuLimit: 1000,
  memoryLimit: 512,
  replicas: 2,
  autoscaleEnabled: true,
  autoscaleMin: 2,
  autoscaleMax: 6,
  autoscaleCpuTarget: 70,
  autoscaleMemTarget: null,
  autoscaleCooldown: 240,
  serverId: SERVER_ID,
  status: "running",
  containerId: "abc123",
  containerImage: "deploykit/api:latest",
  healthCheckType: "http",
  healthCheckPath: "/health",
  healthCheckTimeout: 7,
  healthCheckInterval: 12,
  healthCheckRetries: 4,
  healthCheckRequired: true,
  statusPageVisible: true,
  scanEnabled: null,
  previewEnabled: true,
  previewDomain: "preview.acme.io",
  isPreview: false,
  parentApplicationId: null,
  previewPrNumber: null,
  previewBranch: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const dbRow = (over: Partial<DatabaseT> = {}): DatabaseT => ({
  id: DB_ID,
  projectId: PROJECT_ID,
  name: "acme-db",
  type: "postgresql",
  version: "16-alpine",
  internalPort: 5432,
  dbUser: "admin",
  dbPassword: CIPHERTEXT,
  databaseName: "acme-db",
  containerId: "def456",
  status: "running",
  serverId: SERVER_ID,
  replicaSet: false,
  backupEnabled: true,
  backupCron: "0 3 * * *",
  backupRetention: 14,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const stackRow = (over: Partial<ComposeServiceT> = {}): ComposeServiceT => ({
  id: STACK_ID,
  projectId: PROJECT_ID,
  name: "n8n",
  sourceType: "template",
  templateId: "n8n",
  templateVersion: "1.0.0",
  composeFile: "services:\n  n8n:\n    image: n8nio/n8n:latest\n",
  envVars: CIPHERTEXT,
  mounts: [{ filePath: "config/n8n.json", content: '{"secret":"s3cret"}' }],
  serverId: null,
  status: "running",
  statusPageVisible: false,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const domainRow = (over: Partial<DomainT> = {}): DomainT => ({
  id: "66666666-6666-6666-6666-666666666666",
  applicationId: APP_ID,
  domain: "api.acme.io",
  port: 3000,
  https: true,
  certificateResolver: "letsencrypt",
  createdAt: NOW,
  ...over,
});

const stackDomainRow = (
  over: Partial<ComposeDomainT> = {},
): ComposeDomainT => ({
  id: "77777777-7777-7777-7777-777777777777",
  composeServiceId: STACK_ID,
  serviceName: "n8n",
  domain: "n8n.acme.io",
  port: 5678,
  path: null,
  https: true,
  certificateResolver: "letsencrypt",
  createdAt: NOW,
  ...over,
});

const taskRow = (over: Partial<ScheduledTaskT> = {}): ScheduledTaskT => ({
  id: "88888888-8888-8888-8888-888888888888",
  applicationId: APP_ID,
  composeServiceId: null,
  databaseId: null,
  serviceName: null,
  name: "migrate",
  command: "pnpm db:migrate",
  cron: "0 4 * * *",
  timezone: "Europe/Madrid",
  enabled: true,
  timeoutSeconds: 600,
  lastRunAt: NOW,
  lastStatus: "success",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const fullExport = (over: Partial<ProjectExportI> = {}): ProjectExportI[] => [
  {
    row: projectRow(),
    members: [{ email: "dev@acme.io", role: "operator" }],
    applications: [
      {
        row: appRow(),
        env: {
          NODE_ENV: "production",
          WEB_URL: "https://app.acme.io",
          JWT_SECRET: "sup3r-s3cret-value",
          DATABASE_URL: "postgres://admin:pw@acme-db:5432/acme",
        },
        sourceToken: "ghp_plaintexttoken",
        webhookSecret: "plaintext-webhook-secret",
        domains: [domainRow()],
        tasks: [taskRow()],
      },
    ],
    databases: [
      { row: dbRow(), password: "plaintext-db-password", tasks: [] },
    ],
    stacks: [
      {
        row: stackRow(),
        env: { N8N_HOST: "n8n.acme.io", N8N_ENCRYPTION_KEY: "abc123secretkey" },
        domains: [stackDomainRow()],
        tasks: [
          taskRow({
            applicationId: null,
            composeServiceId: STACK_ID,
            serviceName: "n8n",
            name: "prune",
            cron: null,
          }),
        ],
      },
    ],
    ...over,
  },
];

const build = (includeSecrets: boolean) =>
  buildManifest(fullExport(), {
    includeSecrets,
    exportedAt: NOW.toISOString(),
    serverNames: { [SERVER_ID]: "prod-eu-1" },
  });

/**
 * Every *value* in the secrets document — `name` and `filePath` are how the
 * two documents are paired, so they are expected to appear in both.
 */
const secretValues = (
  value: unknown,
  key: string | undefined,
  out: string[] = [],
): string[] => {
  if (key === "name" || key === "filePath") return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value))
    for (const item of value) secretValues(item, key, out);
  else if (value && typeof value === "object")
    for (const [childKey, child] of Object.entries(value))
      secretValues(child, childKey, out);
  return out;
};

describe("manifest column coverage", () => {
  const tables = {
    projects,
    projectMembers,
    applications,
    databases,
    composeServices,
    domains,
    composeDomains,
    scheduledTasks,
  };

  for (const [name, table] of Object.entries(tables)) {
    it(`accounts for every column of ${name}`, () => {
      const key = name as keyof typeof MANIFEST_COLUMNS;
      const declared = Object.keys(getTableColumns(table)).sort();
      const accounted = [
        ...MANIFEST_COLUMNS[key],
        ...EXCLUDED_COLUMNS[key],
      ].sort();
      // A new column has to be put in one list or the other on purpose:
      // otherwise it silently stops being part of every backup from now on.
      expect(accounted).toEqual(declared);
    });
  }
});

describe("buildManifest", () => {
  it("never emits ciphertext, whatever the rows hold", () => {
    const { manifest, secrets } = build(true);
    const text = stringify(manifest) + stringify(secrets);
    expect(text).not.toContain(CIPHERTEXT);
    expect(text).not.toMatch(CIPHERTEXT_PATTERN);
  });

  it("keeps every withheld value out of the config document", () => {
    const { manifest, secrets } = build(true);
    const configText = stringify(manifest);
    const values = secretValues(secrets?.projects, undefined);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(configText).not.toContain(value);
  });

  it("withholds credentials and keeps ordinary settings", () => {
    const { manifest, secrets } = build(true);
    const app = manifest.projects[0]!.applications![0]!;

    expect(app.env).toEqual({
      NODE_ENV: "production",
      WEB_URL: "https://app.acme.io",
    });
    expect(app.withheldSecrets).toEqual([
      "DATABASE_URL",
      "JWT_SECRET",
      "buildArg:NPM_TOKEN",
      "sourceToken",
      "webhookSecret",
    ]);
    expect(app.buildArgs).toEqual({ NODE_VERSION: "20" });

    const appSecrets = secrets!.projects[0]!.applications![0]!;
    expect(appSecrets.env).toEqual({
      DATABASE_URL: "postgres://admin:pw@acme-db:5432/acme",
      JWT_SECRET: "sup3r-s3cret-value",
    });
    expect(appSecrets.buildArgs).toEqual({ NPM_TOKEN: "npm_deadbeefdeadbeef" });
    expect(appSecrets.sourceToken).toBe("ghp_plaintexttoken");
  });

  it("withholds a stack mount's contents but keeps its path", () => {
    const { manifest, secrets } = build(true);
    const stack = manifest.projects[0]!.stacks![0]!;

    expect(stack.mounts).toEqual([{ filePath: "config/n8n.json" }]);
    expect(stack.withheldSecrets).toEqual([
      "N8N_ENCRYPTION_KEY",
      "mount:config/n8n.json",
    ]);
    expect(secrets!.projects[0]!.stacks![0]!.mounts).toEqual([
      { filePath: "config/n8n.json", content: '{"secret":"s3cret"}' },
    ]);
  });

  it("produces no secrets document when it was not asked for", () => {
    const { manifest, secrets } = build(false);
    expect(secrets).toBeNull();
    // The names of the withheld keys are still advertised, so a restore can
    // say what it is missing.
    expect(manifest.projects[0]!.databases![0]!.withheldSecrets).toEqual([
      "password",
    ]);
  });

  it("leaves out runtime state and references the server by name", () => {
    const { manifest } = build(false);
    const text = stringify(manifest);

    expect(text).not.toContain("abc123"); // containerId
    expect(text).not.toContain("deploykit/api:latest"); // containerImage
    expect(text).not.toContain(SERVER_ID);
    expect(manifest.projects[0]!.applications![0]!.server).toBe("prod-eu-1");
    expect(manifest.projects[0]!.applications![0]!.tasks![0]).not.toHaveProperty(
      "lastStatus",
    );
  });

  it("skips preview applications", () => {
    const rows = fullExport();
    rows[0]!.applications.push({
      row: appRow({
        id: "99999999-9999-9999-9999-999999999999",
        name: "api-pr-12",
        isPreview: true,
      }),
      env: {},
      sourceToken: null,
      webhookSecret: null,
      domains: [],
      tasks: [],
    });

    const { manifest } = buildManifest(rows, {
      includeSecrets: false,
      exportedAt: NOW.toISOString(),
      serverNames: {},
    });
    expect(manifest.projects[0]!.applications!.map((a) => a.name)).toEqual([
      "api",
    ]);
  });

  it("warns when a Compose file has a withheld value written into it", () => {
    const rows = fullExport();
    rows[0]!.stacks[0]!.row = stackRow({
      composeFile:
        "services:\n  n8n:\n    environment:\n      KEY: abc123secretkey\n",
    });

    const { warnings } = buildManifest(rows, {
      includeSecrets: true,
      exportedAt: NOW.toISOString(),
      serverNames: {},
    });
    expect(warnings.join(" ")).toContain("N8N_ENCRYPTION_KEY");
  });

  it("validates its own output against the import schema", () => {
    const { warnings } = build(true);
    expect(warnings.filter((w) => w.includes("may not import cleanly"))).toEqual(
      [],
    );
  });
});

describe("toApplicationValues", () => {
  it("round-trips every configuration field", () => {
    const original = appRow();
    const { manifest } = build(false);
    const entry = manifest.projects[0]!.applications![0]!;

    const values = toApplicationValues(entry, {
      projectId: PROJECT_ID,
      serverId: SERVER_ID,
      envVars: CIPHERTEXT,
      sourceToken: CIPHERTEXT,
      webhookSecret: CIPHERTEXT,
    });

    for (const column of MANIFEST_COLUMNS.applications) {
      if (column === "envVars" || column === "sourceToken")
        continue; // supplied by the caller, already encrypted
      if (column === "webhookSecret") continue;
      if (column === "buildArgs") {
        // The withheld build arg travels in the secrets document.
        expect(values.buildArgs).toEqual({ NODE_VERSION: "20" });
        continue;
      }
      expect({ [column]: values[column as keyof typeof values] }).toEqual({
        [column]: original[column as keyof ApplicationT],
      });
    }
  });
});
