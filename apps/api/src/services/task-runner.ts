import { eq, sql } from "drizzle-orm";

import { DATABASE_IMAGES } from "@deploykit/shared";

import { db } from "../db/index";
import {
  applications,
  composeServices,
  databases,
  scheduledTasks,
  taskRuns,
} from "../db/schema/index";
import { decrypt, decryptEnvVars } from "../lib/encryption";
import { createOutputTail } from "../lib/output-tail";
import { emitTaskLog, emitTaskStatus } from "../lib/socket";
import { getComposeRunnerForServer, getDockerForServer } from "./docker-factory";
import { listComposeServices } from "./compose";
import { fireNotification } from "./notifier";

import type { ApplicationT, DatabaseT, TaskRunT } from "../db/schema/index";
import type { DatabaseType, TaskRunStatusT } from "@deploykit/shared";
import type { OneOffResultI } from "./docker";

/**
 * Builds the container spec for a one-off run, and (Task 9) orchestrates one.
 *
 * Every run is a fresh container from the service's image — never a `docker
 * exec` into the live one — so a command works with the app stopped, keeps a
 * long job off the container serving traffic, and needs no choice between
 * replicas.
 *
 * Four differences from a deployed container are load-bearing:
 *   • no published ports — a one-off would collide with the app's host port;
 *   • RestartPolicy "no" — set by the transport, since a finished command must
 *     not be restarted (createAndStart defaults to unless-stopped);
 *   • no `deploykit.service` label — that label is how listServiceContainers,
 *     the autoscaler, the metrics scheduler and the log collector find a
 *     service's replicas; a one-off carrying it would be scaled or scraped;
 *   • the command is wrapped in a shell, so `a && b`, pipes and globs behave
 *     the way a user typing them expects.
 */

const SHARED_NETWORK = "deploykit-network";
const SHELL = "/bin/sh";

class OneOffNotDeployedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OneOffNotDeployedError";
  }
}

interface OneOffSpecI {
  image: string;
  name: string;
  cmd: string[];
  env: string[];
  labels: Record<string, string>;
  volumes?: string[];
  networkName: string;
  cpuMillicores?: number;
  memoryMb?: number;
  timeoutMs: number;
}

type OneOffInputT =
  | {
      kind: "application";
      runId: string;
      command: string;
      timeoutSeconds: number;
      app: ApplicationT;
      env: Record<string, string>;
    }
  | {
      kind: "database";
      runId: string;
      command: string;
      timeoutSeconds: number;
      database: DatabaseT;
      password: string;
    };

/** The env var each client tool reads its password from, so a command never
 *  has to carry the password in its arguments. */
const passwordEnvFor = (type: DatabaseType): string | null => {
  switch (type) {
    case "postgresql":
      return "PGPASSWORD";
    case "mysql":
    case "mariadb":
      return "MYSQL_PWD";
    case "redis":
      return "REDISCLI_AUTH";
    default:
      return null; // mongodb: mongosh takes credentials as arguments
  }
};

const toEnvList = (vars: Record<string, string>): string[] =>
  Object.entries(vars).map(([k, v]) => `${k}=${v}`);

const buildOneOffSpec = (input: OneOffInputT): OneOffSpecI => {
  const name = `dk-oneoff-${input.runId.slice(0, 8)}`;
  const labels: Record<string, string> = {
    "deploykit.managed": "true",
    "deploykit.oneoff": "true",
    "deploykit.run": input.runId,
  };
  const base = {
    name,
    cmd: [SHELL, "-lc", input.command],
    labels,
    networkName: SHARED_NETWORK,
    timeoutMs: input.timeoutSeconds * 1000,
  };

  if (input.kind === "application") {
    if (!input.app.containerImage) {
      throw new OneOffNotDeployedError(
        `Application "${input.app.name}" has no image yet — deploy it once before running commands.`,
      );
    }
    return {
      ...base,
      image: input.app.containerImage,
      env: toEnvList(input.env),
      volumes: input.app.volumes ?? undefined,
      cpuMillicores: input.app.cpuLimit ?? undefined,
      memoryMb: input.app.memoryLimit ?? undefined,
    };
  }

  const type = input.database.type as DatabaseType;
  const image = DATABASE_IMAGES[type]?.image;
  if (!image) {
    throw new OneOffNotDeployedError(
      `Unknown database type "${input.database.type}".`,
    );
  }

  const pwEnv = passwordEnvFor(type);
  return {
    ...base,
    image,
    // The client connects over the shared network; the data volume is
    // deliberately not mounted — two processes must not open the same files.
    env: toEnvList({
      DK_DB_HOST: `dk-${input.database.name}`,
      DK_DB_PORT: String(input.database.internalPort),
      DK_DB_USER: input.database.dbUser ?? "",
      DK_DB_NAME: input.database.databaseName ?? "",
      DK_DB_PASSWORD: input.password,
      ...(pwEnv ? { [pwEnv]: input.password } : {}),
    }),
  };
};

/**
 * Execute an existing `task_runs` row to completion: resolve the target, run
 * the command in a one-off container, stream output, then persist status,
 * exit code, duration and the output tail.
 *
 * The row is created before this is called — by the router for a manual run,
 * by the worker for a scheduled one — so the client always has an id to
 * subscribe to before the container exists.
 */
const runTaskRun = async (runId: string): Promise<void> => {
  const run = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, runId),
  });
  if (!run) {
    console.error(`[task] Run ${runId} vanished before it could start`);
    return;
  }

  const tail = createOutputTail();
  const startedAt = Date.now();

  // Flush the tail periodically so a client that reconnects mid-run, or one
  // that never subscribed, still sees output before the run ends.
  const flush = setInterval(() => {
    db.update(taskRuns)
      .set({ output: tail.value(), outputTruncated: tail.truncated() })
      .where(eq(taskRuns.id, runId))
      .catch(() => {});
  }, 2000);

  const onLog = (chunk: string) => {
    tail.push(chunk);
    emitTaskLog(runId, chunk);
  };

  const finish = async (
    status: TaskRunStatusT,
    exitCode: number | null,
    containerId: string | null,
  ) => {
    clearInterval(flush);
    await db
      .update(taskRuns)
      .set({
        status,
        exitCode,
        containerId,
        output: tail.value(),
        outputTruncated: tail.truncated(),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      })
      .where(eq(taskRuns.id, runId));

    if (run.taskId) {
      await db
        .update(scheduledTasks)
        .set({ lastRunAt: new Date(), lastStatus: status })
        .where(eq(scheduledTasks.id, run.taskId));
    }

    emitTaskStatus(runId, status, exitCode);
    await pruneRuns(run);

    if (status !== "success") {
      await notifyFailure(run, status, exitCode).catch(() => {});
    }
  };

  try {
    // The row carries its own timeout snapshot, so an ad-hoc run honours what
    // the user typed and an edit to the task cannot retime a running command.
    const timeoutMs = run.timeoutSeconds * 1000;
    let result: OneOffResultI;

    if (run.composeServiceId) {
      const stack = await db.query.composeServices.findFirst({
        where: eq(composeServices.id, run.composeServiceId),
      });
      if (!stack) throw new Error("Stack was deleted");
      if (!run.serviceName) throw new Error("Run has no Compose service name");
      const services = listComposeServices(stack.composeFile);
      if (!services.includes(run.serviceName)) {
        throw new Error(
          `This stack has no service named "${run.serviceName}". Available: ${services.join(", ")}`,
        );
      }

      const { runner } = await getComposeRunnerForServer(stack.serverId);
      result = await runner.runOneOff({
        stackId: stack.id,
        stackName: stack.name,
        serviceName: run.serviceName,
        command: run.command,
        timeoutMs,
        onLog,
      });
    } else if (run.applicationId) {
      const app = await db.query.applications.findFirst({
        where: eq(applications.id, run.applicationId),
      });
      if (!app) throw new Error("Application was deleted");

      const spec = buildOneOffSpec({
        kind: "application",
        runId,
        command: run.command,
        timeoutSeconds: timeoutMs / 1000,
        app,
        env: app.envVars ? decryptEnvVars(app.envVars) : {},
      });
      const { docker } = await getDockerForServer(app.serverId);
      result = await docker.runOneOff(spec, onLog);
    } else if (run.databaseId) {
      const database = await db.query.databases.findFirst({
        where: eq(databases.id, run.databaseId),
      });
      if (!database) throw new Error("Database was deleted");

      const spec = buildOneOffSpec({
        kind: "database",
        runId,
        command: run.command,
        timeoutSeconds: timeoutMs / 1000,
        database,
        password: database.dbPassword ? decrypt(database.dbPassword) : "",
      });
      const { docker } = await getDockerForServer(database.serverId);
      result = await docker.runOneOff(spec, onLog);
    } else {
      throw new Error("Run has no target");
    }

    if (result.timedOut) {
      onLog("\n[deploykit] Command timed out and was killed.\n");
      await finish("timed_out", result.exitCode, result.containerId);
      return;
    }

    await finish(
      result.exitCode === 0 ? "success" : "failed",
      result.exitCode,
      result.containerId,
    );
  } catch (err: any) {
    onLog(`\n[deploykit] ${err?.message ?? err}\n`);
    await finish("failed", null, null);
  }
};

/** Keep the 50 newest runs per task (or per service, for ad-hoc runs). */
const RUN_RETENTION = 50;

const pruneRuns = async (run: TaskRunT): Promise<void> => {
  const key = run.taskId
    ? sql`${taskRuns.taskId} = ${run.taskId}`
    : run.applicationId
      ? sql`${taskRuns.taskId} IS NULL AND ${taskRuns.applicationId} = ${run.applicationId}`
      : run.composeServiceId
        ? sql`${taskRuns.taskId} IS NULL AND ${taskRuns.composeServiceId} = ${run.composeServiceId}`
        : sql`${taskRuns.taskId} IS NULL AND ${taskRuns.databaseId} = ${run.databaseId}`;

  await db.execute(sql`
    DELETE FROM ${taskRuns}
    WHERE ${taskRuns.id} IN (
      SELECT ${taskRuns.id} FROM ${taskRuns}
      WHERE ${key}
      ORDER BY ${taskRuns.startedAt} DESC
      OFFSET ${RUN_RETENTION}
    )
  `);
};

const notifyFailure = async (
  run: TaskRunT,
  status: TaskRunStatusT,
  exitCode: number | null,
): Promise<void> => {
  const projectId = await projectIdForRun(run);
  if (!projectId) return;

  const label = run.taskName ?? "Ad-hoc command";
  await fireNotification({
    event: "task.failed",
    projectId,
    title: `Task failed: ${label}`,
    message:
      status === "timed_out"
        ? `"${run.command}" timed out.`
        : `"${run.command}" exited with code ${exitCode ?? "unknown"}.`,
    meta: { taskRunId: run.id, command: run.command, exitCode },
  });
};

/** The project a run belongs to, whichever kind of target it has. */
const projectIdForRun = async (run: TaskRunT): Promise<string | null> => {
  if (run.applicationId) {
    return (
      (
        await db.query.applications.findFirst({
          where: eq(applications.id, run.applicationId),
          columns: { projectId: true },
        })
      )?.projectId ?? null
    );
  }
  if (run.composeServiceId) {
    return (
      (
        await db.query.composeServices.findFirst({
          where: eq(composeServices.id, run.composeServiceId),
          columns: { projectId: true },
        })
      )?.projectId ?? null
    );
  }
  if (run.databaseId) {
    return (
      (
        await db.query.databases.findFirst({
          where: eq(databases.id, run.databaseId),
          columns: { projectId: true },
        })
      )?.projectId ?? null
    );
  }
  return null;
};

export {
  buildOneOffSpec,
  OneOffNotDeployedError,
  SHARED_NETWORK,
  runTaskRun,
  projectIdForRun,
  type OneOffSpecI,
  type OneOffInputT,
};
