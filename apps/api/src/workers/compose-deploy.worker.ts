import { Worker, type Job } from "bullmq";
import { eq, sql } from "drizzle-orm";

import { db } from "../db/index";
import { composeServices, deployments } from "../db/schema/index";

import { transformCompose } from "../services/compose";
import { fireNotification } from "../services/notifier";
import { getComposeRunnerForServer } from "../services/docker-factory";

import { redis } from "../lib/redis";
import { redactSecrets } from "../lib/redact";
import { decryptEnvVars } from "../lib/encryption";
import { acquireDeployLock, releaseDeployLock } from "../lib/deploy-lock";
import { emitDeployLog, emitDeployStatus } from "../lib/socket";

/**
 * Deploys a Compose stack.
 *
 * Much shorter than the application worker because there is no build step: a
 * stack is images plus configuration, so the work is transform the YAML, write
 * the stack directory, and hand it to `docker compose`.
 *
 * It reuses the application worker's machinery deliberately — the same
 * deployments table, the same Redis deploy lock, the same Socket.IO log rooms —
 * so the UI, the history and the log pipeline need no notion of which kind of
 * service produced a deployment.
 */

interface ComposeDeployJobDataI {
  deploymentId: string;
  composeServiceId: string;
  /** `redeploy` recreates containers and re-pulls images; `up` is incremental. */
  mode: "up" | "redeploy";
}

export const startComposeDeployWorker = () => {
  const worker = new Worker<ComposeDeployJobDataI>(
    "compose-deploy",
    async (job: Job<ComposeDeployJobDataI>) => {
      const { deploymentId, composeServiceId, mode } = job.data;

      const log = (msg: string) => {
        const safe = redactSecrets(msg);
        emitDeployLog(deploymentId, safe);
        // Fire-and-forget by design; a rejected floating promise would crash
        // the process, so swallow DB hiccups here.
        appendLog(deploymentId, safe).catch(() => {});
      };

      try {
        // Serialize per stack: two concurrent `compose up` runs against the
        // same project fight over the same containers.
        await acquireDeployLock(composeServiceId, deploymentId, () =>
          log(
            "Another deployment of this stack is in progress — waiting for it to finish...\n",
          ),
        );

        log("Loading stack configuration...\n");

        const stack = await db.query.composeServices.findFirst({
          where: eq(composeServices.id, composeServiceId),
          with: { domains: true },
        });
        if (!stack) throw new Error("Compose service not found");

        await updateDeployment(deploymentId, {
          status: "deploying",
          startedAt: new Date(),
        });
        emitDeployStatus(deploymentId, "deploying", { composeServiceId });

        const { runner, isRemote } = await getComposeRunnerForServer(
          stack.serverId,
        );
        if (isRemote) log("Deploying to remote server...\n");

        if (!(await runner.available())) {
          throw new Error(
            "The `docker compose` plugin is not available on the target host. " +
              "Install docker-compose-plugin (Alpine: docker-cli-compose) and try again.",
          );
        }

        const env = stack.envVars ? decryptEnvVars(stack.envVars) : {};

        log("Preparing Compose file...\n");
        const composeFile = transformCompose({
          composeServiceId: stack.id,
          projectId: stack.projectId,
          stackName: stack.name,
          composeFile: stack.composeFile,
          domains: stack.domains.map((d) => ({
            serviceName: d.serviceName,
            domain: d.domain,
            port: d.port,
            https: d.https,
            path: d.path,
            certificateResolver: d.certificateResolver,
          })),
        });

        const mounts = stack.mounts ?? [];
        if (mounts.length > 0) {
          log(`Writing ${mounts.length} configuration file(s)...\n`);
        }

        await runner.writeStack({
          stackId: stack.id,
          composeFile,
          env,
          mounts,
        });

        log("\n── Starting stack ─────────────────────────────\n");
        await runner.up({
          stackId: stack.id,
          stackName: stack.name,
          onLog: log,
          forceRecreate: mode === "redeploy",
          pull: mode === "redeploy",
        });

        await db
          .update(composeServices)
          .set({ status: "running", updatedAt: new Date() })
          .where(eq(composeServices.id, composeServiceId));

        await updateDeployment(deploymentId, {
          status: "success",
          finishedAt: new Date(),
        });
        emitDeployStatus(deploymentId, "success", { composeServiceId });

        log("\n══════════════════════════════════════════════\n");
        log("✓ Stack deployed!\n");
        for (const d of stack.domains) {
          log(`  → ${d.https ? "https" : "http"}://${d.domain}${d.path ?? ""}\n`);
        }
        log("══════════════════════════════════════════════\n");

        fireNotification({
          event: "deploy.success",
          projectId: stack.projectId,
          title: `Deploy succeeded: ${stack.name}`,
          message: `Stack ${stack.name} deployed successfully.`,
          meta: {
            composeServiceId: stack.id,
            composeServiceName: stack.name,
            deploymentId,
          },
        }).catch(() => {}); // fire-and-forget
      } catch (error: any) {
        const errorMsg =
          error?.message ||
          error?.toString?.() ||
          String(error) ||
          "Unknown error";
        log(`\n✗ Deployment failed: ${errorMsg}\n`);

        await updateDeployment(deploymentId, {
          status: "failed",
          errorMessage: errorMsg,
          finishedAt: new Date(),
        });

        await db
          .update(composeServices)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(composeServices.id, composeServiceId));

        emitDeployStatus(deploymentId, "failed", {
          composeServiceId,
          error: errorMsg,
        });

        try {
          const failed = await db.query.composeServices.findFirst({
            where: eq(composeServices.id, composeServiceId),
            columns: { id: true, name: true, projectId: true },
          });
          if (failed) {
            fireNotification({
              event: "deploy.failed",
              projectId: failed.projectId,
              title: `Deploy failed: ${failed.name}`,
              message: `Deployment of stack ${failed.name} failed: ${errorMsg}`,
              meta: {
                composeServiceId: failed.id,
                composeServiceName: failed.name,
                deploymentId,
                error: errorMsg,
              },
            }).catch(() => {});
          }
        } catch {
          // Notification failure is non-fatal
        }

        throw error;
      } finally {
        await releaseDeployLock(composeServiceId, deploymentId);
      }
    },
    {
      connection: redis,
      concurrency: 2,
      // Same rationale as the application worker: survive event-loop stalls
      // without losing the job lock, and fail a stalled job loudly rather than
      // re-running it alongside its still-running first execution.
      lockDuration: 120_000,
      stalledInterval: 60_000,
      maxStalledCount: 0,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 20 },
    },
  );

  worker.on("completed", (job) => {
    console.log(`[compose-deploy-worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[compose-deploy-worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("stalled", (jobId) => {
    console.warn(
      `[compose-deploy-worker] Job ${jobId} stalled (lock lost); marking it failed instead of re-running`,
    );
  });

  console.log("[compose-deploy-worker] Worker started, waiting for jobs...");
  return worker;
};

async function updateDeployment(
  id: string,
  data: Partial<typeof deployments.$inferInsert>,
) {
  await db.update(deployments).set(data).where(eq(deployments.id, id));
}

async function appendLog(deploymentId: string, log: string) {
  // Append in SQL, not in JS: log() fires these without awaiting, and a
  // read-modify-write here silently drops chunks when two appends overlap.
  await db
    .update(deployments)
    .set({
      deployLogs: sql`coalesce(${deployments.deployLogs}, '') || ${log}`,
    })
    .where(eq(deployments.id, deploymentId));
}
