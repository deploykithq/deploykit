import {
  buildArgWithheldName,
  CONFIG_MANIFEST_KIND,
  configManifestSchema,
  MANIFEST_VERSION,
  mountWithheldName,
  SECRETS_MANIFEST_KIND,
  splitEnvSecrets,
  WITHHELD_DB_PASSWORD,
  WITHHELD_SOURCE_TOKEN,
  WITHHELD_WEBHOOK_SECRET,
} from "@deploykit/shared";

import type {
  ConfigManifestI,
  ManifestApplicationI,
  ManifestDatabaseI,
  ManifestStackI,
  ManifestStackDomainI,
  ManifestStackTaskI,
  ManifestTaskI,
  ManifestDomainI,
  SecretsManifestI,
} from "@deploykit/shared";
import type {
  ApplicationT,
  ComposeDomainT,
  ComposeMountI,
  ComposeServiceT,
  DatabaseT,
  DomainT,
  NewApplicationT,
  NewComposeDomainT,
  NewComposeServiceT,
  NewDatabaseT,
  NewDomainT,
  NewScheduledTaskT,
  ProjectT,
  ScheduledTaskT,
} from "../db/schema/index";

/**
 * The two halves of the configuration manifest, as pure data.
 *
 * Nothing here touches the database, the crypto helpers or YAML: it maps rows
 * to the manifest and manifest entries back to insert payloads, which is what
 * lets the whole shape be tested without a database or an `ENCRYPTION_KEY`.
 * `config-export.ts` reads and decrypts; `config-import.ts` plans and writes.
 */

/** One application, with its env already decrypted by the caller. */
interface AppExportI {
  row: ApplicationT;
  env: Record<string, string>;
  sourceToken: string | null;
  webhookSecret: string | null;
  domains: DomainT[];
  tasks: ScheduledTaskT[];
}

interface DatabaseExportI {
  row: DatabaseT;
  password: string | null;
  tasks: ScheduledTaskT[];
}

interface StackExportI {
  row: ComposeServiceT;
  env: Record<string, string>;
  domains: ComposeDomainT[];
  tasks: ScheduledTaskT[];
}

interface ProjectExportI {
  row: ProjectT;
  members: Array<{ email: string; role: string }>;
  applications: AppExportI[];
  databases: DatabaseExportI[];
  stacks: StackExportI[];
}

interface BuildManifestOptsI {
  /** When false, the secrets document is not produced at all. */
  includeSecrets: boolean;
  exportedAt: string;
  /** serverId → server name: the manifest references a server by name. */
  serverNames: Record<string, string>;
}

interface BuildManifestResultI {
  manifest: ConfigManifestI;
  secrets: SecretsManifestI | null;
  warnings: string[];
}

/**
 * Columns each resource contributes to the manifest, and the ones deliberately
 * left out. `config-manifest.test.ts` asserts the two together account for
 * every column Drizzle declares, so adding a column fails the test instead of
 * quietly dropping out of every backup taken from then on.
 */
const MANIFEST_COLUMNS = {
  projects: [
    "name",
    "description",
    "statusPageEnabled",
    "statusPageSlug",
    "statusPageTitle",
  ],
  projectMembers: ["userId", "role"],
  applications: [
    "name",
    "sourceType",
    "repositoryUrl",
    "branch",
    "sourceToken",
    "rootDirectory",
    "webhookSecret",
    "buildType",
    "dockerfilePath",
    "buildArgs",
    "startCommand",
    "envVars",
    "volumes",
    "port",
    "cpuLimit",
    "memoryLimit",
    "replicas",
    "autoscaleEnabled",
    "autoscaleMin",
    "autoscaleMax",
    "autoscaleCpuTarget",
    "autoscaleMemTarget",
    "autoscaleCooldown",
    "serverId",
    "healthCheckType",
    "healthCheckPath",
    "healthCheckTimeout",
    "healthCheckInterval",
    "healthCheckRetries",
    "healthCheckRequired",
    "statusPageVisible",
    "scanEnabled",
    "previewEnabled",
    "previewDomain",
    // GitHub's own identifiers for the repo, so an import can re-link the app
    // to whatever installation on the destination instance can see it. The
    // installation's local uuid is excluded — it means nothing elsewhere.
    "githubRepoId",
    "githubRepoFullName",
    "commitStatusEnabled",
  ],
  databases: [
    "name",
    "type",
    "version",
    "internalPort",
    "dbUser",
    "dbPassword",
    "databaseName",
    "serverId",
    "replicaSet",
    "backupEnabled",
    "backupCron",
    "backupRetention",
  ],
  composeServices: [
    "name",
    "sourceType",
    "templateId",
    "templateVersion",
    "composeFile",
    "envVars",
    "mounts",
    "serverId",
    "statusPageVisible",
  ],
  domains: ["domain", "port", "https", "certificateResolver"],
  composeDomains: [
    "serviceName",
    "domain",
    "port",
    "path",
    "https",
    "certificateResolver",
  ],
  scheduledTasks: [
    "serviceName",
    "name",
    "command",
    "cron",
    "timezone",
    "enabled",
    "timeoutSeconds",
  ],
} as const;

const EXCLUDED_COLUMNS = {
  projects: ["id", "createdAt", "updatedAt"],
  projectMembers: ["id", "projectId", "createdAt", "updatedAt"],
  applications: [
    "id",
    "projectId",
    // Container state: rebuilt by a deploy, never restored.
    "status",
    "containerId",
    "containerImage",
    // Preview deployments are ephemeral PR environments.
    "isPreview",
    "parentApplicationId",
    "previewPrNumber",
    "previewBranch",
    "previewPrCommentId",
    // Local uuid of a GitHub App installation: meaningless on another
    // instance, which re-links by githubRepoId instead.
    "githubInstallationId",
    "createdAt",
    "updatedAt",
  ],
  databases: ["id", "projectId", "containerId", "status", "createdAt", "updatedAt"],
  composeServices: ["id", "projectId", "status", "createdAt", "updatedAt"],
  domains: ["id", "applicationId", "createdAt"],
  composeDomains: ["id", "composeServiceId", "createdAt"],
  scheduledTasks: [
    "id",
    "applicationId",
    "composeServiceId",
    "databaseId",
    // Denormalised last-run state, not configuration.
    "lastRunAt",
    "lastStatus",
    "createdAt",
    "updatedAt",
  ],
} as const;

/**
 * Drop keys that carry no information, so the document stays readable. Every
 * column this strips is nullable with a null default, so an omitted key and an
 * explicit null import to the same row.
 */
const compact = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0
    )
      continue;
    out[key] = value;
  }
  return out;
};

const byName = <T extends { name: string }>(a: T, b: T): number =>
  a.name.localeCompare(b.name);

const toManifestTask = (task: ScheduledTaskT): Record<string, unknown> =>
  compact({
    name: task.name,
    command: task.command,
    cron: task.cron,
    timezone: task.timezone,
    enabled: task.enabled,
    timeoutSeconds: task.timeoutSeconds,
  });

const toManifestStackTask = (task: ScheduledTaskT): Record<string, unknown> =>
  compact({ ...toManifestTask(task), serviceName: task.serviceName });

const toManifestDomain = (domain: DomainT): Record<string, unknown> =>
  compact({
    domain: domain.domain,
    port: domain.port,
    https: domain.https,
    certificateResolver: domain.certificateResolver,
  });

const toManifestStackDomain = (
  domain: ComposeDomainT,
): Record<string, unknown> =>
  compact({
    serviceName: domain.serviceName,
    domain: domain.domain,
    port: domain.port,
    path: domain.path,
    https: domain.https,
    certificateResolver: domain.certificateResolver,
  });

const serverNameOf = (
  serverId: string | null,
  serverNames: Record<string, string>,
): string | null => (serverId ? serverNames[serverId] ?? null : null);

/**
 * Build both documents from what the exporter read.
 *
 * The result is validated against the import schema before it is returned: an
 * export that could not be imported back is a broken backup, so a row that no
 * longer satisfies the current validators is reported as a warning rather than
 * discovered months later during a restore.
 */
const buildManifest = (
  projects: ProjectExportI[],
  opts: BuildManifestOptsI,
): BuildManifestResultI => {
  const warnings: string[] = [];
  const manifestProjects: Record<string, unknown>[] = [];
  const secretProjects: Record<string, unknown>[] = [];

  for (const project of [...projects].sort((a, b) =>
    a.row.name.localeCompare(b.row.name),
  )) {
    const apps: Record<string, unknown>[] = [];
    const appSecrets: Record<string, unknown>[] = [];

    for (const app of [...project.applications].sort((a, b) =>
      byName(a.row, b.row),
    )) {
      // A preview is an ephemeral PR environment the webhook recreates; the
      // exporter filters them out in SQL, and this keeps that true of any
      // caller.
      if (app.row.isPreview) continue;

      const envSplit = splitEnvSecrets(app.env);
      const buildArgSplit = splitEnvSecrets(app.row.buildArgs ?? {});
      const withheld = [
        ...envSplit.withheld,
        ...buildArgSplit.withheld.map(buildArgWithheldName),
      ];
      if (app.sourceToken) withheld.push(WITHHELD_SOURCE_TOKEN);
      if (app.webhookSecret) withheld.push(WITHHELD_WEBHOOK_SECRET);

      apps.push(
        compact({
          name: app.row.name,
          sourceType: app.row.sourceType,
          repositoryUrl: app.row.repositoryUrl,
          branch: app.row.branch,
          rootDirectory: app.row.rootDirectory,
          buildType: app.row.buildType,
          dockerfilePath: app.row.dockerfilePath,
          buildArgs: buildArgSplit.env,
          startCommand: app.row.startCommand,
          port: app.row.port,
          volumes: app.row.volumes,
          cpuLimit: app.row.cpuLimit,
          memoryLimit: app.row.memoryLimit,
          replicas: app.row.replicas,
          autoscale: compact({
            enabled: app.row.autoscaleEnabled,
            min: app.row.autoscaleMin,
            max: app.row.autoscaleMax,
            cpuTarget: app.row.autoscaleCpuTarget,
            memTarget: app.row.autoscaleMemTarget,
            cooldown: app.row.autoscaleCooldown,
          }),
          healthCheck: compact({
            type: app.row.healthCheckType,
            path: app.row.healthCheckPath,
            timeout: app.row.healthCheckTimeout,
            interval: app.row.healthCheckInterval,
            retries: app.row.healthCheckRetries,
            required: app.row.healthCheckRequired,
          }),
          // Only worth a block when it says something: a disabled preview with
          // no domain is exactly the default.
          preview:
            app.row.previewEnabled || app.row.previewDomain
              ? compact({
                  enabled: app.row.previewEnabled,
                  domain: app.row.previewDomain,
                })
              : null,
          statusPageVisible: app.row.statusPageVisible,
          scanEnabled: app.row.scanEnabled,
          // Only worth a block for an app actually wired to the GitHub App.
          github:
            app.row.githubRepoId || app.row.githubRepoFullName
              ? compact({
                  repoId: app.row.githubRepoId,
                  repoFullName: app.row.githubRepoFullName,
                  commitStatus: app.row.commitStatusEnabled,
                })
              : null,
          server: serverNameOf(app.row.serverId, opts.serverNames),
          env: envSplit.env,
          withheldSecrets: withheld.sort(),
          domains: [...app.domains]
            .sort((a, b) => a.domain.localeCompare(b.domain))
            .map(toManifestDomain),
          tasks: [...app.tasks].sort(byName).map(toManifestTask),
        }),
      );

      if (opts.includeSecrets && withheld.length > 0)
        appSecrets.push(
          compact({
            name: app.row.name,
            env: envSplit.secrets,
            buildArgs: buildArgSplit.secrets,
            sourceToken: app.sourceToken,
            webhookSecret: app.webhookSecret,
          }),
        );
    }

    const dbs: Record<string, unknown>[] = [];
    const dbSecrets: Record<string, unknown>[] = [];

    for (const database of [...project.databases].sort((a, b) =>
      byName(a.row, b.row),
    )) {
      dbs.push(
        compact({
          name: database.row.name,
          type: database.row.type,
          version: database.row.version,
          internalPort: database.row.internalPort,
          dbUser: database.row.dbUser,
          databaseName: database.row.databaseName,
          replicaSet: database.row.replicaSet,
          server: serverNameOf(database.row.serverId, opts.serverNames),
          backup: compact({
            enabled: database.row.backupEnabled,
            cron: database.row.backupCron,
            retention: database.row.backupRetention,
          }),
          withheldSecrets: database.password ? [WITHHELD_DB_PASSWORD] : [],
          tasks: [...database.tasks].sort(byName).map(toManifestTask),
        }),
      );

      if (opts.includeSecrets && database.password)
        dbSecrets.push({
          name: database.row.name,
          password: database.password,
        });
    }

    const stacks: Record<string, unknown>[] = [];
    const stackSecrets: Record<string, unknown>[] = [];

    for (const stack of [...project.stacks].sort((a, b) => byName(a.row, b.row))) {
      const envSplit = splitEnvSecrets(stack.env);
      const mounts = stack.row.mounts ?? [];
      const withheld = [
        ...envSplit.withheld,
        ...mounts
          .filter((mount) => mount.content.length > 0)
          .map((mount) => mountWithheldName(mount.filePath)),
      ];

      // The Compose file has to travel in the config document — a stack cannot
      // be re-created without it — so a credential written straight into it is
      // reported instead of silently committed.
      const leaked = Object.entries(envSplit.secrets).filter(
        ([, value]) =>
          value.length >= 8 && stack.row.composeFile.includes(value),
      );
      for (const [key] of leaked)
        warnings.push(
          `Stack "${stack.row.name}": the Compose file contains the value of ${key} literally, so it is present in the config document.`,
        );

      stacks.push(
        compact({
          name: stack.row.name,
          sourceType: stack.row.sourceType,
          template: stack.row.templateId
            ? compact({
                id: stack.row.templateId,
                version: stack.row.templateVersion,
              })
            : null,
          composeFile: stack.row.composeFile,
          mounts: mounts
            .map((mount) => ({ filePath: mount.filePath }))
            .sort((a, b) => a.filePath.localeCompare(b.filePath)),
          statusPageVisible: stack.row.statusPageVisible,
          server: serverNameOf(stack.row.serverId, opts.serverNames),
          env: envSplit.env,
          withheldSecrets: withheld.sort(),
          domains: [...stack.domains]
            .sort((a, b) => a.domain.localeCompare(b.domain))
            .map(toManifestStackDomain),
          tasks: [...stack.tasks].sort(byName).map(toManifestStackTask),
        }),
      );

      if (opts.includeSecrets && withheld.length > 0)
        stackSecrets.push(
          compact({
            name: stack.row.name,
            env: envSplit.secrets,
            mounts: mounts.filter((mount) => mount.content.length > 0),
          }),
        );
    }

    manifestProjects.push(
      compact({
        name: project.row.name,
        description: project.row.description,
        statusPage:
          project.row.statusPageEnabled ||
          project.row.statusPageSlug ||
          project.row.statusPageTitle
            ? compact({
                enabled: project.row.statusPageEnabled,
                slug: project.row.statusPageSlug,
                title: project.row.statusPageTitle,
              })
            : null,
        members: [...project.members].sort((a, b) =>
          a.email.localeCompare(b.email),
        ),
        applications: apps,
        databases: dbs,
        stacks,
      }),
    );

    if (
      opts.includeSecrets &&
      (appSecrets.length > 0 || dbSecrets.length > 0 || stackSecrets.length > 0)
    )
      secretProjects.push(
        compact({
          name: project.row.name,
          applications: appSecrets,
          databases: dbSecrets,
          stacks: stackSecrets,
        }),
      );
  }

  const document = {
    version: MANIFEST_VERSION,
    kind: CONFIG_MANIFEST_KIND,
    exportedAt: opts.exportedAt,
    projects: manifestProjects,
  };

  const parsed = configManifestSchema.safeParse(document);
  if (!parsed.success)
    for (const issue of parsed.error.issues.slice(0, 10))
      warnings.push(
        `This export may not import cleanly — ${issue.path.join(".")}: ${issue.message}`,
      );

  return {
    manifest: parsed.success
      ? parsed.data
      : (document as unknown as ConfigManifestI),
    secrets:
      opts.includeSecrets && secretProjects.length > 0
        ? ({
            version: MANIFEST_VERSION,
            kind: SECRETS_MANIFEST_KIND,
            exportedAt: opts.exportedAt,
            projects: secretProjects,
          } as unknown as SecretsManifestI)
        : null,
    warnings,
  };
};

interface AppInsertOptsI {
  projectId: string;
  serverId: string | null;
  /** Already encrypted by the caller — this module has no crypto. */
  envVars: string | null;
  sourceToken: string | null;
  webhookSecret: string | null;
}

const toApplicationValues = (
  app: ManifestApplicationI,
  opts: AppInsertOptsI,
): NewApplicationT => ({
  projectId: opts.projectId,
  name: app.name,
  sourceType: app.sourceType,
  repositoryUrl: app.repositoryUrl ?? null,
  branch: app.branch,
  sourceToken: opts.sourceToken,
  rootDirectory: app.rootDirectory ?? null,
  webhookSecret: opts.webhookSecret,
  buildType: app.buildType,
  dockerfilePath: app.dockerfilePath ?? "./Dockerfile",
  buildArgs: app.buildArgs ?? null,
  startCommand: app.startCommand ?? null,
  envVars: opts.envVars,
  volumes: app.volumes && app.volumes.length > 0 ? app.volumes : null,
  port: app.port ?? null,
  cpuLimit: app.cpuLimit ?? null,
  memoryLimit: app.memoryLimit ?? null,
  replicas: app.replicas,
  autoscaleEnabled: app.autoscale?.enabled ?? false,
  autoscaleMin: app.autoscale?.min ?? 1,
  autoscaleMax: app.autoscale?.max ?? 3,
  autoscaleCpuTarget: app.autoscale?.cpuTarget ?? null,
  autoscaleMemTarget: app.autoscale?.memTarget ?? null,
  autoscaleCooldown: app.autoscale?.cooldown ?? 180,
  serverId: opts.serverId,
  healthCheckType: app.healthCheck?.type ?? "http",
  healthCheckPath: app.healthCheck?.path ?? "/",
  healthCheckTimeout: app.healthCheck?.timeout ?? 5,
  healthCheckInterval: app.healthCheck?.interval ?? 10,
  healthCheckRetries: app.healthCheck?.retries ?? 6,
  healthCheckRequired: app.healthCheck?.required ?? false,
  statusPageVisible: app.statusPageVisible,
  scanEnabled: app.scanEnabled ?? null,
  previewEnabled: app.preview?.enabled ?? false,
  previewDomain: app.preview?.domain ?? null,
  // The installation is resolved after insert, by repo id — see config-import.
  githubRepoId: app.github?.repoId ?? null,
  githubRepoFullName: app.github?.repoFullName ?? null,
  commitStatusEnabled: app.github?.commitStatus ?? true,
});

interface DatabaseInsertOptsI {
  projectId: string;
  serverId: string | null;
  /** Already encrypted, or null for redis. */
  dbPassword: string | null;
}

const toDatabaseValues = (
  database: ManifestDatabaseI,
  opts: DatabaseInsertOptsI,
): NewDatabaseT => ({
  projectId: opts.projectId,
  name: database.name,
  type: database.type,
  version: database.version ?? null,
  internalPort: database.internalPort,
  dbUser: database.dbUser ?? null,
  dbPassword: opts.dbPassword,
  databaseName: database.databaseName ?? null,
  serverId: opts.serverId,
  replicaSet: database.replicaSet,
  backupEnabled: database.backup?.enabled ?? false,
  backupCron: database.backup?.cron ?? null,
  backupRetention: database.backup?.retention ?? 7,
  // Provisioned on the first Start, never by the import itself.
  containerId: null,
  status: "idle",
});

interface StackInsertOptsI {
  projectId: string;
  serverId: string | null;
  /** Already encrypted. */
  envVars: string | null;
  mounts: ComposeMountI[] | null;
}

const toStackValues = (
  stack: ManifestStackI,
  opts: StackInsertOptsI,
): NewComposeServiceT => ({
  projectId: opts.projectId,
  name: stack.name,
  sourceType: stack.sourceType,
  templateId: stack.template?.id ?? null,
  templateVersion: stack.template?.version ?? null,
  composeFile: stack.composeFile,
  envVars: opts.envVars,
  mounts: opts.mounts,
  serverId: opts.serverId,
  statusPageVisible: stack.statusPageVisible,
  status: "idle",
});

const toDomainValues = (
  domain: ManifestDomainI,
  applicationId: string,
): NewDomainT => ({
  applicationId,
  domain: domain.domain,
  port: domain.port,
  https: domain.https,
  certificateResolver: domain.certificateResolver ?? "letsencrypt",
});

const toStackDomainValues = (
  domain: ManifestStackDomainI,
  composeServiceId: string,
): NewComposeDomainT => ({
  composeServiceId,
  serviceName: domain.serviceName,
  domain: domain.domain,
  port: domain.port,
  path: domain.path ?? null,
  https: domain.https,
  certificateResolver: domain.certificateResolver ?? "letsencrypt",
});

/** Exactly one owner column is set, as the CHECK constraint requires. */
type TaskOwnerT =
  | { applicationId: string }
  | { databaseId: string }
  | { composeServiceId: string; serviceName: string };

const toTaskValues = (
  task: ManifestTaskI | ManifestStackTaskI,
  owner: TaskOwnerT,
): NewScheduledTaskT => ({
  ...owner,
  name: task.name,
  command: task.command,
  cron: task.cron ?? null,
  timezone: task.timezone,
  enabled: task.enabled,
  timeoutSeconds: task.timeoutSeconds,
});

export {
  MANIFEST_COLUMNS,
  EXCLUDED_COLUMNS,
  buildManifest,
  toApplicationValues,
  toDatabaseValues,
  toStackValues,
  toDomainValues,
  toStackDomainValues,
  toTaskValues,
  type AppExportI,
  type DatabaseExportI,
  type StackExportI,
  type ProjectExportI,
  type BuildManifestOptsI,
  type BuildManifestResultI,
  type TaskOwnerT,
};
