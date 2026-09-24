import { and, eq, inArray, or } from "drizzle-orm";
import { stringify } from "yaml";

import { db } from "../db/index";
import {
  applications,
  composeDomains,
  composeServices,
  databases,
  domains,
  projectMembers,
  projects,
  scheduledTasks,
  servers,
  users,
} from "../db/schema/index";
import { decrypt, decryptEnvVars } from "../lib/encryption";
import { buildManifest } from "./config-manifest";

import type { SQL } from "drizzle-orm";
import type {
  AppExportI,
  DatabaseExportI,
  ProjectExportI,
  StackExportI,
} from "./config-manifest";

/**
 * Reads the instance's configuration and renders it as YAML.
 *
 * This is the only half that touches the database and the crypto helpers. The
 * shape of the document lives in `config-manifest.ts`, which is pure, so the
 * queries here exist purely to avoid an N+1: one round trip per table, grouped
 * in memory afterwards.
 */

interface ConfigExportResultI {
  /** The committable document. */
  manifest: string;
  /** The withheld values, or null when they were not requested. */
  secrets: string | null;
  warnings: string[];
  counts: {
    projects: number;
    applications: number;
    databases: number;
    stacks: number;
    domains: number;
    tasks: number;
  };
}

/**
 * `lineWidth: 0` stops long scalars being folded — a folded 500 KB Compose
 * file is still valid YAML but unreadable, and readability is the reason this
 * is YAML at all. `blockQuote: "literal"` renders them as `|` blocks.
 */
const YAML_OPTIONS = { lineWidth: 0, blockQuote: "literal" } as const;

const groupBy = <T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    const bucket = out.get(id);
    if (bucket) bucket.push(row);
    else out.set(id, [row]);
  }
  return out;
};

/**
 * Decrypt without letting one unreadable row abort the whole backup: a row
 * encrypted under a key this instance no longer has is reported and skipped,
 * because a partial export beats no export at all.
 */
const safeDecryptEnv = (
  encrypted: string | null,
  label: string,
  warnings: string[],
): Record<string, string> => {
  if (!encrypted) return {};
  try {
    return decryptEnvVars(encrypted);
  } catch {
    warnings.push(`${label}: env vars could not be decrypted and were skipped.`);
    return {};
  }
};

const safeDecrypt = (
  encrypted: string | null,
  label: string,
  warnings: string[],
): string | null => {
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    warnings.push(`${label} could not be decrypted and was skipped.`);
    return null;
  }
};

const gatherProjects = async (
  projectIds: string[] | null,
  warnings: string[],
): Promise<ProjectExportI[]> => {
  const projectRows = projectIds
    ? projectIds.length > 0
      ? await db.select().from(projects).where(inArray(projects.id, projectIds))
      : []
    : await db.select().from(projects);
  if (projectRows.length === 0) return [];

  const ids = projectRows.map((project) => project.id);

  // Preview applications are ephemeral PR environments recreated by a webhook.
  const appRows = await db
    .select()
    .from(applications)
    .where(
      and(inArray(applications.projectId, ids), eq(applications.isPreview, false)),
    );
  const dbRows = await db
    .select()
    .from(databases)
    .where(inArray(databases.projectId, ids));
  const stackRows = await db
    .select()
    .from(composeServices)
    .where(inArray(composeServices.projectId, ids));

  const appIds = appRows.map((app) => app.id);
  const dbIds = dbRows.map((row) => row.id);
  const stackIds = stackRows.map((stack) => stack.id);

  const domainRows =
    appIds.length > 0
      ? await db.select().from(domains).where(inArray(domains.applicationId, appIds))
      : [];
  const stackDomainRows =
    stackIds.length > 0
      ? await db
          .select()
          .from(composeDomains)
          .where(inArray(composeDomains.composeServiceId, stackIds))
      : [];

  const ownerFilters: SQL[] = [];
  if (appIds.length > 0)
    ownerFilters.push(inArray(scheduledTasks.applicationId, appIds));
  if (dbIds.length > 0)
    ownerFilters.push(inArray(scheduledTasks.databaseId, dbIds));
  if (stackIds.length > 0)
    ownerFilters.push(inArray(scheduledTasks.composeServiceId, stackIds));
  const taskRows =
    ownerFilters.length > 0
      ? await db
          .select()
          .from(scheduledTasks)
          .where(ownerFilters.length === 1 ? ownerFilters[0] : or(...ownerFilters))
      : [];

  const memberRows = await db
    .select({
      projectId: projectMembers.projectId,
      email: users.email,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(inArray(projectMembers.projectId, ids));

  const domainsByApp = groupBy(domainRows, (row) => row.applicationId);
  const domainsByStack = groupBy(stackDomainRows, (row) => row.composeServiceId);
  const tasksByApp = groupBy(taskRows, (row) => row.applicationId);
  const tasksByDb = groupBy(taskRows, (row) => row.databaseId);
  const tasksByStack = groupBy(taskRows, (row) => row.composeServiceId);
  const appsByProject = groupBy(appRows, (row) => row.projectId);
  const dbsByProject = groupBy(dbRows, (row) => row.projectId);
  const stacksByProject = groupBy(stackRows, (row) => row.projectId);
  const membersByProject = groupBy(memberRows, (row) => row.projectId);

  // The App's credentials are instance-level and tied to a webhook URL, so
  // they are never exported. An importing instance re-links by repo id.
  const connectedCount = appRows.filter((a) => a.githubInstallationId).length;
  if (connectedCount > 0) {
    warnings.push(
      `${connectedCount} application(s) deploy through this instance's GitHub App. ` +
        "The App itself is not exported; on import they are re-linked to an " +
        "installation that can see the same repository, or fall back to their " +
        "repository URL.",
    );
  }

  return projectRows.map((project) => {
    const appExports: AppExportI[] = (appsByProject.get(project.id) ?? []).map(
      (app) => ({
        row: app,
        env: safeDecryptEnv(app.envVars, `Application "${app.name}"`, warnings),
        sourceToken: safeDecrypt(
          app.sourceToken,
          `Application "${app.name}": source token`,
          warnings,
        ),
        webhookSecret: safeDecrypt(
          app.webhookSecret,
          `Application "${app.name}": webhook secret`,
          warnings,
        ),
        domains: domainsByApp.get(app.id) ?? [],
        tasks: tasksByApp.get(app.id) ?? [],
      }),
    );

    const dbExports: DatabaseExportI[] = (dbsByProject.get(project.id) ?? []).map(
      (row) => ({
        row,
        password: safeDecrypt(
          row.dbPassword,
          `Database "${row.name}": password`,
          warnings,
        ),
        tasks: tasksByDb.get(row.id) ?? [],
      }),
    );

    const stackExports: StackExportI[] = (
      stacksByProject.get(project.id) ?? []
    ).map((stack) => ({
      row: stack,
      env: safeDecryptEnv(stack.envVars, `Stack "${stack.name}"`, warnings),
      domains: domainsByStack.get(stack.id) ?? [],
      tasks: tasksByStack.get(stack.id) ?? [],
    }));

    return {
      row: project,
      members: (membersByProject.get(project.id) ?? []).map((member) => ({
        email: member.email,
        role: member.role,
      })),
      applications: appExports,
      databases: dbExports,
      stacks: stackExports,
    };
  });
};

/**
 * Export the whole instance (`projectIds: null`) or a single project.
 *
 * The caller is responsible for authorization — `routers/config.ts` gates the
 * instance export on the global admin role and the project export on the
 * project's `canViewSecrets`, because the document carries Compose files and
 * env var names either way.
 */
const exportConfig = async (opts: {
  projectIds: string[] | null;
  includeSecrets: boolean;
}): Promise<ConfigExportResultI> => {
  const warnings: string[] = [];
  const exportedAt = new Date().toISOString();
  const gathered = await gatherProjects(opts.projectIds, warnings);

  const serverRows = await db
    .select({ id: servers.id, name: servers.name })
    .from(servers);
  const serverNames = Object.fromEntries(
    serverRows.map((server) => [server.id, server.name]),
  );

  const built = buildManifest(gathered, {
    includeSecrets: opts.includeSecrets,
    exportedAt,
    serverNames,
  });

  return {
    manifest: stringify(built.manifest, YAML_OPTIONS),
    secrets: built.secrets ? stringify(built.secrets, YAML_OPTIONS) : null,
    warnings: [...warnings, ...built.warnings],
    counts: {
      projects: gathered.length,
      applications: gathered.reduce((n, p) => n + p.applications.length, 0),
      databases: gathered.reduce((n, p) => n + p.databases.length, 0),
      stacks: gathered.reduce((n, p) => n + p.stacks.length, 0),
      domains: gathered.reduce(
        (n, p) =>
          n +
          p.applications.reduce((m, a) => m + a.domains.length, 0) +
          p.stacks.reduce((m, s) => m + s.domains.length, 0),
        0,
      ),
      tasks: gathered.reduce(
        (n, p) =>
          n +
          p.applications.reduce((m, a) => m + a.tasks.length, 0) +
          p.databases.reduce((m, d) => m + d.tasks.length, 0) +
          p.stacks.reduce((m, s) => m + s.tasks.length, 0),
        0,
      ),
    },
  };
};

export { exportConfig, type ConfigExportResultI };
