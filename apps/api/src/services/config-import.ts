import { eq } from "drizzle-orm";
import { parse } from "yaml";

import {
  buildArgWithheldName,
  CONFIG_MANIFEST_KIND,
  configManifestSchema,
  MANIFEST_VERSION,
  mountWithheldName,
  SECRETS_MANIFEST_KIND,
  secretsManifestSchema,
  WITHHELD_DB_PASSWORD,
  WITHHELD_SOURCE_TOKEN,
  WITHHELD_WEBHOOK_SECRET,
} from "@deploykit/shared";

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
import { assertValidCron, InvalidCronError } from "../lib/cron";
import { encrypt, encryptEnvVars, generatePassword } from "../lib/encryption";
import {
  upsertBackupSchedule,
  upsertTaskSchedule,
} from "../lib/task-scheduler";
import { listComposeServices } from "./compose";
import { installationCanAccessRepo } from "./github-app";
import {
  toApplicationValues,
  toDatabaseValues,
  toDomainValues,
  toStackDomainValues,
  toStackValues,
  toTaskValues,
} from "./config-manifest";

import type {
  ConfigManifestI,
  ContainerNameConflictI,
  ImportPlanI,
  PlanActionT,
  PlanItemI,
  ManifestApplicationI,
  ManifestDatabaseI,
  ManifestDomainI,
  ManifestProjectI,
  ManifestStackDomainI,
  ManifestStackI,
  ManifestStackTaskI,
  ManifestTaskI,
  SecretsManifestI,
  UserRole,
} from "@deploykit/shared";
import type { ComposeMountI, DatabaseT, ScheduledTaskT } from "../db/schema/index";

/**
 * Applying a configuration manifest.
 *
 * Two halves, deliberately: `planImport` is pure and decides everything, and
 * `runImport` executes what it decided. A dry run is the same call with the
 * execution skipped, so the preview an operator confirms cannot disagree with
 * what then happens.
 *
 * The semantics are **create what is missing, never modify what exists**:
 *
 * - An existing *project* is descended into, so re-applying a file after
 *   adding one application creates just that application.
 * - An existing *application, database or stack* is left completely alone,
 *   children included. Adding a domain or a cron to a service somebody is
 *   already running is a change to that service, not a missing resource.
 */

/** What the planner needs to know about the target instance. */
interface InstanceIndexI {
  projects: Array<{ id: string; name: string }>;
  applications: Array<{ id: string; projectId: string; name: string }>;
  databases: Array<{ id: string; projectId: string; name: string }>;
  stacks: Array<{ id: string; projectId: string; name: string }>;
  /** Every hostname already routed, from both domain tables. */
  routedDomains: string[];
  statusPageSlugs: Array<{ projectId: string; slug: string }>;
  servers: Array<{ id: string; name: string }>;
  users: Array<{ id: string; email: string; role: string }>;
  members: Array<{ projectId: string; userId: string }>;
}

type PasswordSourceT = "provided" | "generate" | "none";

interface AppOpI {
  entry: ManifestApplicationI;
  serverId: string | null;
  env: Record<string, string>;
  buildArgs: Record<string, string> | null;
  sourceToken: string | null;
  webhookSecret: string | null;
  domains: ManifestDomainI[];
  tasks: ManifestTaskI[];
}

interface DbOpI {
  entry: ManifestDatabaseI;
  serverId: string | null;
  passwordSource: PasswordSourceT;
  password: string | null;
  tasks: ManifestTaskI[];
}

interface StackOpI {
  entry: ManifestStackI;
  serverId: string | null;
  env: Record<string, string>;
  mounts: ComposeMountI[] | null;
  domains: ManifestStackDomainI[];
  tasks: ManifestStackTaskI[];
}

interface ProjectOpI {
  entry: ManifestProjectI;
  /** Set when the project already exists and is being descended into. */
  existingId: string | null;
  statusPage: { enabled: boolean; slug: string | null; title: string | null };
  members: Array<{ userId: string; role: UserRole }>;
  applications: AppOpI[];
  databases: DbOpI[];
  stacks: StackOpI[];
}

interface PlanInputI {
  manifest: ConfigManifestI;
  secrets: SecretsManifestI | null;
  index: InstanceIndexI;
  /** What to do when a referenced server does not exist here. */
  onMissingServer: "fail" | "local";
}

class ManifestParseError extends Error {}

/**
 * Parse a document the user uploaded.
 *
 * `uniqueKeys` and `maxAliasCount` are passed explicitly rather than relied on
 * as defaults, so a dependency bump cannot quietly accept a duplicate key or
 * an alias bomb. The `kind` is checked before the schema so uploading the
 * secrets file into the manifest slot says exactly that.
 */
const parseDocument = (text: string, expected: string): unknown => {
  let raw: unknown;
  try {
    raw = parse(text, { uniqueKeys: true, maxAliasCount: 100 });
  } catch (err) {
    throw new ManifestParseError(
      `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ManifestParseError("The file is empty or is not a YAML mapping.");

  const doc = raw as Record<string, unknown>;
  if (doc.kind !== expected)
    throw new ManifestParseError(
      `Expected a "${expected}" document but got "${String(doc.kind ?? "none")}".`,
    );
  if (doc.version !== MANIFEST_VERSION)
    throw new ManifestParseError(
      `Unsupported manifest version ${String(doc.version)} — this DeployKit reads version ${MANIFEST_VERSION}.`,
    );
  return doc;
};

const parseManifest = (text: string): ConfigManifestI => {
  const doc = parseDocument(text, CONFIG_MANIFEST_KIND);
  const parsed = configManifestSchema.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ManifestParseError(
      `Invalid manifest at ${issue?.path.join(".") || "root"}: ${issue?.message}`,
    );
  }
  return parsed.data;
};

const parseSecrets = (text: string): SecretsManifestI => {
  const doc = parseDocument(text, SECRETS_MANIFEST_KIND);
  const parsed = secretsManifestSchema.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ManifestParseError(
      `Invalid secrets file at ${issue?.path.join(".") || "root"}: ${issue?.message}`,
    );
  }
  return parsed.data;
};

const sameName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

const cronError = (cron: string, timezone: string): string | null => {
  try {
    assertValidCron(cron, timezone);
    return null;
  } catch (err) {
    return err instanceof InvalidCronError ? err.message : "Invalid cron pattern";
  }
};

/**
 * Decide what the import would do. Pure: every fact about the instance arrives
 * in `index`, and nothing is generated here — a database password that has to
 * be invented is recorded as `passwordSource: "generate"` so a dry run does
 * not mint a credential it throws away.
 */
const planImport = (
  input: PlanInputI,
): { plan: ImportPlanI; ops: ProjectOpI[] } => {
  const items: PlanItemI[] = [];
  const warnings: string[] = [];
  const containerNameConflicts: ContainerNameConflictI[] = [];
  const missingSecrets: string[] = [];
  const ops: ProjectOpI[] = [];

  const secretsFor = (projectName: string) =>
    input.secrets?.projects.find((project) => sameName(project.name, projectName));

  /** Names claimed by rows that already exist, plus the ones this file adds. */
  const claimedContainerNames = new Map<string, string>();
  for (const app of input.index.applications) {
    const project = input.index.projects.find((p) => p.id === app.projectId);
    claimedContainerNames.set(
      app.name.toLowerCase(),
      `project ${project?.name ?? "?"} / application ${app.name}`,
    );
  }
  for (const database of input.index.databases) {
    const project = input.index.projects.find((p) => p.id === database.projectId);
    claimedContainerNames.set(
      database.name.toLowerCase(),
      `project ${project?.name ?? "?"} / database ${database.name}`,
    );
  }
  const claimedStackNames = new Map<string, string>();
  for (const stack of input.index.stacks) {
    const project = input.index.projects.find((p) => p.id === stack.projectId);
    claimedStackNames.set(
      stack.name.toLowerCase(),
      `project ${project?.name ?? "?"} / stack ${stack.name}`,
    );
  }

  const claimedDomains = new Set(
    input.index.routedDomains.map((domain) => domain.toLowerCase()),
  );
  const slugsInFile = new Map<string, string>();

  const resolveServer = (
    name: string | null | undefined,
    path: string,
  ): { serverId: string | null; error: string | null } => {
    if (!name) return { serverId: null, error: null };
    const matches = input.index.servers.filter((server) =>
      sameName(server.name, name),
    );
    if (matches.length === 1)
      return { serverId: matches[0]!.id, error: null };
    if (matches.length > 1)
      return {
        serverId: null,
        error: `more than one server is named "${name}" — rename one first`,
      };
    if (input.onMissingServer === "local") {
      warnings.push(
        `${path}: server "${name}" does not exist here, so it will run on the local host.`,
      );
      return { serverId: null, error: null };
    }
    return {
      serverId: null,
      error: `server "${name}" does not exist on this instance`,
    };
  };

  for (const project of input.manifest.projects) {
    const matches = input.index.projects.filter((existing) =>
      sameName(existing.name, project.name),
    );
    if (matches.length > 1) {
      items.push({
        kind: "project",
        path: project.name,
        action: "error",
        reason: `${matches.length} projects are named "${project.name}" — rename one first`,
      });
      continue;
    }

    const existingId = matches[0]?.id ?? null;
    items.push({
      kind: "project",
      path: project.name,
      action: existingId ? "skip-exists" : "create",
    });

    // Status page slug carries a partial unique index: a collision would abort
    // the whole transaction, so the page is imported disabled instead.
    let statusPage = {
      enabled: project.statusPage?.enabled ?? false,
      slug: project.statusPage?.slug ?? null,
      title: project.statusPage?.title ?? null,
    };
    if (statusPage.slug) {
      const takenByOther = input.index.statusPageSlugs.some(
        (row) => row.slug === statusPage.slug && row.projectId !== existingId,
      );
      const takenInFile = slugsInFile.has(statusPage.slug);
      if (takenByOther || takenInFile) {
        warnings.push(
          `Project "${project.name}": status page disabled because the slug "${statusPage.slug}" is already in use.`,
        );
        statusPage = { enabled: false, slug: null, title: statusPage.title };
      } else slugsInFile.set(statusPage.slug, project.name);
    }

    const memberOps: Array<{ userId: string; role: UserRole }> = [];
    for (const member of project.members ?? []) {
      const path = `${project.name} / ${member.email}`;
      const user = input.index.users.find((row) =>
        sameName(row.email, member.email),
      );
      if (!user) {
        items.push({
          kind: "member",
          path,
          action: "skip",
          reason: "no user with that email on this instance",
        });
        continue;
      }
      if (user.role === "admin") {
        items.push({
          kind: "member",
          path,
          action: "skip",
          reason: "global admins already have access to every project",
        });
        continue;
      }
      const already =
        existingId !== null &&
        input.index.members.some(
          (row) => row.projectId === existingId && row.userId === user.id,
        );
      if (already) {
        items.push({ kind: "member", path, action: "skip-exists" });
        continue;
      }
      items.push({ kind: "member", path, action: "create" });
      memberOps.push({ userId: user.id, role: member.role });
    }

    const projectSecrets = secretsFor(project.name);
    const appOps: AppOpI[] = [];

    for (const app of project.applications ?? []) {
      const path = `${project.name} / ${app.name}`;
      if (
        existingId !== null &&
        input.index.applications.some(
          (row) => row.projectId === existingId && sameName(row.name, app.name),
        )
      ) {
        items.push({ kind: "application", path, action: "skip-exists" });
        continue;
      }

      const { serverId, error } = resolveServer(app.server, path);
      if (error) {
        items.push({ kind: "application", path, action: "error", reason: error });
        continue;
      }

      const claimedBy = claimedContainerNames.get(app.name.toLowerCase());
      if (claimedBy)
        containerNameConflicts.push({
          kind: "application",
          containerName: `dk-${app.name}`,
          importingInto: project.name,
          alreadyUsedBy: claimedBy,
        });
      claimedContainerNames.set(
        app.name.toLowerCase(),
        `project ${project.name} / application ${app.name}`,
      );

      const appSecrets = projectSecrets?.applications?.find((row) =>
        sameName(row.name, app.name),
      );
      const env = { ...(app.env ?? {}), ...(appSecrets?.env ?? {}) };
      const buildArgs = {
        ...(app.buildArgs ?? {}),
        ...(appSecrets?.buildArgs ?? {}),
      };
      for (const withheld of app.withheldSecrets ?? []) {
        if (withheld === WITHHELD_SOURCE_TOKEN) {
          if (!appSecrets?.sourceToken)
            missingSecrets.push(`${path}: ${WITHHELD_SOURCE_TOKEN}`);
          continue;
        }
        if (withheld === WITHHELD_WEBHOOK_SECRET) {
          if (!appSecrets?.webhookSecret)
            missingSecrets.push(`${path}: ${WITHHELD_WEBHOOK_SECRET}`);
          continue;
        }
        if (withheld.startsWith("buildArg:")) {
          const supplied = Object.keys(buildArgs).some(
            (key) => buildArgWithheldName(key) === withheld,
          );
          if (!supplied) missingSecrets.push(`${path}: ${withheld}`);
          continue;
        }
        if (!(withheld in env)) missingSecrets.push(`${path}: ${withheld}`);
      }

      let blocked = false;
      const domainOps: ManifestDomainI[] = [];
      for (const domain of app.domains ?? []) {
        const domainPath = `${path} / ${domain.domain}`;
        if (claimedDomains.has(domain.domain.toLowerCase())) {
          items.push({
            kind: "domain",
            path: domainPath,
            action: "skip-exists",
            reason: "that hostname is already routed on this instance",
          });
          continue;
        }
        claimedDomains.add(domain.domain.toLowerCase());
        items.push({ kind: "domain", path: domainPath, action: "create" });
        domainOps.push(domain);
      }

      const taskOps: ManifestTaskI[] = [];
      for (const task of app.tasks ?? []) {
        const taskPath = `${path} / ${task.name}`;
        const invalid = task.cron ? cronError(task.cron, task.timezone) : null;
        if (invalid) {
          items.push({
            kind: "task",
            path: taskPath,
            action: "error",
            reason: invalid,
          });
          blocked = true;
          continue;
        }
        items.push({ kind: "task", path: taskPath, action: "create" });
        taskOps.push(task);
      }

      items.push({
        kind: "application",
        path,
        action: blocked ? "error" : "create",
        reason: blocked ? "one of its tasks could not be planned" : undefined,
      });
      if (!blocked)
        appOps.push({
          entry: app,
          serverId,
          env,
          buildArgs: Object.keys(buildArgs).length > 0 ? buildArgs : null,
          sourceToken: appSecrets?.sourceToken ?? null,
          webhookSecret: appSecrets?.webhookSecret ?? null,
          domains: domainOps,
          tasks: taskOps,
        });
    }

    const dbOps: DbOpI[] = [];
    for (const database of project.databases ?? []) {
      const path = `${project.name} / ${database.name}`;
      if (
        existingId !== null &&
        input.index.databases.some(
          (row) =>
            row.projectId === existingId && sameName(row.name, database.name),
        )
      ) {
        items.push({ kind: "database", path, action: "skip-exists" });
        continue;
      }

      const { serverId, error } = resolveServer(database.server, path);
      if (error) {
        items.push({ kind: "database", path, action: "error", reason: error });
        continue;
      }

      const claimedBy = claimedContainerNames.get(database.name.toLowerCase());
      if (claimedBy)
        containerNameConflicts.push({
          kind: "database",
          containerName: `dk-${database.name}`,
          importingInto: project.name,
          alreadyUsedBy: claimedBy,
        });
      claimedContainerNames.set(
        database.name.toLowerCase(),
        `project ${project.name} / database ${database.name}`,
      );

      const backupCron = database.backup?.cron;
      if (database.backup?.enabled && backupCron) {
        const invalid = cronError(backupCron, "UTC");
        if (invalid) {
          items.push({ kind: "database", path, action: "error", reason: invalid });
          continue;
        }
      }

      // redis has no user or password; every other engine needs one before the
      // container can be provisioned, so one is minted at apply time.
      const supplied = projectSecrets?.databases?.find((row) =>
        sameName(row.name, database.name),
      )?.password;
      let passwordSource: PasswordSourceT = "none";
      if (database.type !== "redis") {
        if (supplied) passwordSource = "provided";
        else {
          passwordSource = "generate";
          if ((database.withheldSecrets ?? []).includes(WITHHELD_DB_PASSWORD))
            missingSecrets.push(`${path}: ${WITHHELD_DB_PASSWORD}`);
          warnings.push(
            `Database "${database.name}": no password was supplied, so a new one is generated — anything holding its old connection string must be updated.`,
          );
        }
      }

      let blocked = false;
      const taskOps: ManifestTaskI[] = [];
      for (const task of database.tasks ?? []) {
        const taskPath = `${path} / ${task.name}`;
        const invalid = task.cron ? cronError(task.cron, task.timezone) : null;
        if (invalid) {
          items.push({
            kind: "task",
            path: taskPath,
            action: "error",
            reason: invalid,
          });
          blocked = true;
          continue;
        }
        items.push({ kind: "task", path: taskPath, action: "create" });
        taskOps.push(task);
      }

      items.push({
        kind: "database",
        path,
        action: blocked ? "error" : "create",
        reason: blocked ? "one of its tasks could not be planned" : undefined,
      });
      if (!blocked)
        dbOps.push({
          entry: database,
          serverId,
          passwordSource,
          password: supplied ?? null,
          tasks: taskOps,
        });
    }

    const stackOps: StackOpI[] = [];
    for (const stack of project.stacks ?? []) {
      const path = `${project.name} / ${stack.name}`;
      if (
        existingId !== null &&
        input.index.stacks.some(
          (row) => row.projectId === existingId && sameName(row.name, stack.name),
        )
      ) {
        items.push({ kind: "stack", path, action: "skip-exists" });
        continue;
      }

      let services: string[];
      try {
        services = listComposeServices(stack.composeFile);
      } catch (err) {
        items.push({
          kind: "stack",
          path,
          action: "error",
          reason: err instanceof Error ? err.message : "Invalid Compose file",
        });
        continue;
      }

      const { serverId, error } = resolveServer(stack.server, path);
      if (error) {
        items.push({ kind: "stack", path, action: "error", reason: error });
        continue;
      }

      const claimedBy = claimedStackNames.get(stack.name.toLowerCase());
      if (claimedBy)
        containerNameConflicts.push({
          kind: "stack",
          containerName: `dk-${stack.name}`,
          importingInto: project.name,
          alreadyUsedBy: claimedBy,
        });
      claimedStackNames.set(
        stack.name.toLowerCase(),
        `project ${project.name} / stack ${stack.name}`,
      );

      const stackSecrets = projectSecrets?.stacks?.find((row) =>
        sameName(row.name, stack.name),
      );
      const env = { ...(stack.env ?? {}), ...(stackSecrets?.env ?? {}) };

      const mounts: ComposeMountI[] = (stack.mounts ?? []).map((mount) => {
        const supplied =
          mount.content ??
          stackSecrets?.mounts?.find((row) => row.filePath === mount.filePath)
            ?.content;
        if (supplied === undefined)
          missingSecrets.push(`${path}: ${mountWithheldName(mount.filePath)}`);
        return { filePath: mount.filePath, content: supplied ?? "" };
      });

      for (const withheld of stack.withheldSecrets ?? []) {
        if (withheld.startsWith("mount:")) continue;
        if (!(withheld in env)) missingSecrets.push(`${path}: ${withheld}`);
      }

      let blocked = false;
      const domainOps: ManifestStackDomainI[] = [];
      for (const domain of stack.domains ?? []) {
        const domainPath = `${path} / ${domain.domain}`;
        if (!services.includes(domain.serviceName)) {
          items.push({
            kind: "domain",
            path: domainPath,
            action: "error",
            reason: `the Compose file has no service "${domain.serviceName}"`,
          });
          blocked = true;
          continue;
        }
        if (claimedDomains.has(domain.domain.toLowerCase())) {
          items.push({
            kind: "domain",
            path: domainPath,
            action: "skip-exists",
            reason: "that hostname is already routed on this instance",
          });
          continue;
        }
        claimedDomains.add(domain.domain.toLowerCase());
        items.push({ kind: "domain", path: domainPath, action: "create" });
        domainOps.push(domain);
      }

      const taskOps: ManifestStackTaskI[] = [];
      for (const task of stack.tasks ?? []) {
        const taskPath = `${path} / ${task.name}`;
        if (!services.includes(task.serviceName)) {
          items.push({
            kind: "task",
            path: taskPath,
            action: "error",
            reason: `the Compose file has no service "${task.serviceName}"`,
          });
          blocked = true;
          continue;
        }
        const invalid = task.cron ? cronError(task.cron, task.timezone) : null;
        if (invalid) {
          items.push({
            kind: "task",
            path: taskPath,
            action: "error",
            reason: invalid,
          });
          blocked = true;
          continue;
        }
        items.push({ kind: "task", path: taskPath, action: "create" });
        taskOps.push(task);
      }

      items.push({
        kind: "stack",
        path,
        action: blocked ? "error" : "create",
        reason: blocked
          ? "one of its domains or tasks could not be planned"
          : undefined,
      });
      if (!blocked)
        stackOps.push({
          entry: stack,
          serverId,
          env,
          mounts: mounts.length > 0 ? mounts : null,
          domains: domainOps,
          tasks: taskOps,
        });
    }

    ops.push({
      entry: project,
      existingId,
      statusPage,
      members: memberOps,
      applications: appOps,
      databases: dbOps,
      stacks: stackOps,
    });
  }

  const counts: Record<PlanActionT, number> = {
    create: 0,
    "skip-exists": 0,
    skip: 0,
    error: 0,
  };
  for (const item of items) counts[item.action] += 1;

  return {
    plan: {
      items,
      warnings,
      containerNameConflicts,
      missingSecrets,
      counts,
      secretsProvided: input.secrets !== null,
      applied: false,
    },
    ops,
  };
};

/** One query per table: the planner needs names, not rows. */
const loadInstanceIndex = async (): Promise<InstanceIndexI> => {
  const [
    projectRows,
    appRows,
    dbRows,
    stackRows,
    domainRows,
    stackDomainRows,
    serverRows,
    userRows,
    memberRows,
  ] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, slug: projects.statusPageSlug }).from(projects),
    db
      .select({
        id: applications.id,
        projectId: applications.projectId,
        name: applications.name,
      })
      .from(applications)
      .where(eq(applications.isPreview, false)),
    db
      .select({
        id: databases.id,
        projectId: databases.projectId,
        name: databases.name,
      })
      .from(databases),
    db
      .select({
        id: composeServices.id,
        projectId: composeServices.projectId,
        name: composeServices.name,
      })
      .from(composeServices),
    db.select({ domain: domains.domain }).from(domains),
    db.select({ domain: composeDomains.domain }).from(composeDomains),
    db.select({ id: servers.id, name: servers.name }).from(servers),
    db.select({ id: users.id, email: users.email, role: users.role }).from(users),
    db
      .select({ projectId: projectMembers.projectId, userId: projectMembers.userId })
      .from(projectMembers),
  ]);

  return {
    projects: projectRows.map(({ id, name }) => ({ id, name })),
    applications: appRows,
    databases: dbRows,
    stacks: stackRows,
    routedDomains: [
      ...domainRows.map((row) => row.domain),
      ...stackDomainRows.map((row) => row.domain),
    ],
    statusPageSlugs: projectRows
      .filter((row) => row.slug !== null)
      .map((row) => ({ projectId: row.id, slug: row.slug as string })),
    servers: serverRows,
    users: userRows,
    members: memberRows,
  };
};

interface RunImportOptsI {
  manifestText: string;
  secretsText?: string | null;
  dryRun: boolean;
  onMissingServer: "fail" | "local";
}

/**
 * Plan and, unless this is a dry run, apply.
 *
 * Everything is written in one transaction, so a failure leaves the instance
 * exactly as it was. The BullMQ schedulers are registered *after* the commit:
 * inside it, a rollback would leave Redis firing at rows that no longer exist.
 */
const runImport = async (opts: RunImportOptsI): Promise<ImportPlanI> => {
  const manifest = parseManifest(opts.manifestText);
  const secrets = opts.secretsText ? parseSecrets(opts.secretsText) : null;
  const index = await loadInstanceIndex();
  const { plan, ops } = planImport({
    manifest,
    secrets,
    index,
    onMissingServer: opts.onMissingServer,
  });

  if (opts.dryRun || plan.counts.error > 0) return plan;

  const createdTasks: ScheduledTaskT[] = [];
  const createdDatabases: DatabaseT[] = [];
  /** Applications carrying a GitHub repo id, to re-link after the commit. */
  const createdGithubApps: { id: string; name: string; repoId: number }[] = [];

  await db.transaction(async (tx) => {
    for (const projectOp of ops) {
      let projectId = projectOp.existingId;
      if (!projectId) {
        const [created] = await tx
          .insert(projects)
          .values({
            name: projectOp.entry.name,
            description: projectOp.entry.description ?? null,
            statusPageEnabled: projectOp.statusPage.enabled,
            statusPageSlug: projectOp.statusPage.slug,
            statusPageTitle: projectOp.statusPage.title,
          })
          .returning();
        projectId = created!.id;
      }

      if (projectOp.members.length > 0)
        await tx.insert(projectMembers).values(
          projectOp.members.map((member) => ({
            projectId: projectId as string,
            userId: member.userId,
            role: member.role,
          })),
        );

      for (const appOp of projectOp.applications) {
        const [app] = await tx
          .insert(applications)
          .values(
            toApplicationValues(
              { ...appOp.entry, buildArgs: appOp.buildArgs },
              {
                projectId,
                serverId: appOp.serverId,
                envVars:
                  Object.keys(appOp.env).length > 0
                    ? encryptEnvVars(appOp.env)
                    : null,
                sourceToken: appOp.sourceToken
                  ? encrypt(appOp.sourceToken)
                  : null,
                webhookSecret: appOp.webhookSecret
                  ? encrypt(appOp.webhookSecret)
                  : null,
              },
            ),
          )
          .returning();

        if (app!.githubRepoId) {
          createdGithubApps.push({
            id: app!.id,
            name: app!.name,
            repoId: app!.githubRepoId,
          });
        }

        if (appOp.domains.length > 0)
          await tx
            .insert(domains)
            .values(appOp.domains.map((domain) => toDomainValues(domain, app!.id)));

        for (const task of appOp.tasks) {
          const [created] = await tx
            .insert(scheduledTasks)
            .values(toTaskValues(task, { applicationId: app!.id }))
            .returning();
          createdTasks.push(created!);
        }
      }

      for (const dbOp of projectOp.databases) {
        const password =
          dbOp.passwordSource === "provided"
            ? dbOp.password
            : dbOp.passwordSource === "generate"
              ? generatePassword()
              : null;
        const [database] = await tx
          .insert(databases)
          .values(
            toDatabaseValues(dbOp.entry, {
              projectId,
              serverId: dbOp.serverId,
              dbPassword: password ? encrypt(password) : null,
            }),
          )
          .returning();
        createdDatabases.push(database!);

        for (const task of dbOp.tasks) {
          const [created] = await tx
            .insert(scheduledTasks)
            .values(toTaskValues(task, { databaseId: database!.id }))
            .returning();
          createdTasks.push(created!);
        }
      }

      for (const stackOp of projectOp.stacks) {
        const [stack] = await tx
          .insert(composeServices)
          .values(
            toStackValues(stackOp.entry, {
              projectId,
              serverId: stackOp.serverId,
              envVars:
                Object.keys(stackOp.env).length > 0
                  ? encryptEnvVars(stackOp.env)
                  : null,
              mounts: stackOp.mounts,
            }),
          )
          .returning();

        if (stackOp.domains.length > 0)
          await tx
            .insert(composeDomains)
            .values(
              stackOp.domains.map((domain) =>
                toStackDomainValues(domain, stack!.id),
              ),
            );

        for (const task of stackOp.tasks) {
          const [created] = await tx
            .insert(scheduledTasks)
            .values(
              toTaskValues(task, {
                composeServiceId: stack!.id,
                serviceName: task.serviceName,
              }),
            )
            .returning();
          createdTasks.push(created!);
        }
      }
    }
  });

  // Redis, after the commit. Without these the cron patterns would only start
  // firing after the next restart, when reconcileSchedules() runs.
  for (const task of createdTasks) await upsertTaskSchedule(task);
  for (const database of createdDatabases)
    if (database.backupEnabled) await upsertBackupSchedule(database);

  // Re-link imported applications to this instance's GitHub App, by repo id.
  // Outside the transaction on purpose: it talks to GitHub, and a failure here
  // must not roll back an import that is otherwise complete — the application
  // simply falls back to its repository URL until someone reconnects it.
  const relinkWarnings = await relinkGithubApplications(createdGithubApps);

  return {
    ...plan,
    applied: true,
    warnings: [...plan.warnings, ...relinkWarnings],
  };
};

/**
 * Point imported applications at whichever local installation can see their
 * repository.
 *
 * The manifest carries GitHub's numeric repo id, never an installation: the
 * installation is a uuid local to the instance that exported it. Exactly one
 * candidate is required — with none there is nothing to link to, and with
 * several the choice is genuinely ambiguous and belongs to a human.
 */
const relinkGithubApplications = async (
  imported: { id: string; name: string; repoId: number }[],
): Promise<string[]> => {
  if (imported.length === 0) return [];

  const warnings: string[] = [];
  const installations = await db.query.githubInstallations.findMany();

  if (installations.length === 0) {
    return [
      `${imported.length} application(s) were connected to a GitHub App on the source instance. ` +
        "No App is configured here, so they will use their repository URL until you reconnect them.",
    ];
  }

  for (const app of imported) {
    const matches: typeof installations = [];
    for (const installation of installations) {
      try {
        if (await installationCanAccessRepo(installation, app.repoId)) {
          matches.push(installation);
        }
      } catch {
        // An unreachable GitHub just means no match; the warning below says so.
      }
    }

    if (matches.length === 1) {
      await db
        .update(applications)
        .set({ githubInstallationId: matches[0]!.id })
        .where(eq(applications.id, app.id));
      continue;
    }

    warnings.push(
      matches.length === 0
        ? `${app.name}: no GitHub App installation here can see its repository, so it will use its repository URL until you reconnect it.`
        : `${app.name}: more than one GitHub App installation can see its repository — connect it by hand.`,
    );
  }

  return warnings;
};

export {
  ManifestParseError,
  parseManifest,
  parseSecrets,
  planImport,
  loadInstanceIndex,
  runImport,
  type InstanceIndexI,
  type ProjectOpI,
};
