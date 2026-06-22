import { Worker, type Job } from "bullmq";
import path from "path";
import { writeFileSync } from "fs";
import { eq } from "drizzle-orm";

import { db } from "../db/index";
import { applications, deployments } from "../db/schema/index";

import { GitService } from "../services/git";
import { BuildService } from "../services/build";
import { DockerService } from "../services/docker";
import { getDockerForServer } from "../services/docker-factory";
import { RemoteDockerService } from "../services/remote-docker";
import { fireNotification } from "../services/notifier";

import { decrypt, decryptEnvVars } from "../lib/encryption";
import { redis } from "../lib/redis";
import { emitDeployLog, emitDeployStatus } from "../lib/socket";

import type { BuildType } from "@deploykit/shared";

// Common patterns for tokens, passwords, and keys that may leak into
// build/deploy output. We scrub them before storing or emitting logs.
const SECRET_PATTERNS: RegExp[] = [
  // Generic tokens: ghp_, glpat-, github_pat_, ghs_, sk-, sk_live_, sk_test_
  /\b(ghp_|glpat-|github_pat_|ghs_|sk-|sk_live_|sk_test_)[A-Za-z0-9_-]{10,}\b/g,
  // Bearer / Basic auth headers
  /(Bearer|Basic)\s+[A-Za-z0-9+/=_-]{20,}/gi,
  // x-access-token in URLs (git clone with token)
  /x-access-token:[^@\s]+@/gi,
  // Generic password= or secret= in key=value pairs
  /(password|secret|token|apikey|api_key|access_key|private_key)\s*[=:]\s*\S+/gi,
  // AWS keys
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  // Long hex strings that look like secrets (64+ chars)
  /\b[0-9a-f]{64,}\b/gi,
];

function redactSecrets(msg: string): string {
  let redacted = msg;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (match) => {
      // Keep a short prefix for debugging context
      const prefix = match.slice(0, Math.min(6, match.length));
      return `${prefix}***REDACTED***`;
    });
  }
  return redacted;
}

/**
 * Normalize a user-supplied rootDirectory into a safe relative sub-path.
 * Rejects absolute paths and any "../" traversal that would escape the repo.
 */
function safeRootDirectory(rootDir: string): string {
  const trimmed = rootDir.replace(/^\/|\/$/g, "");
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/"));
  if (
    path.isAbsolute(rootDir) ||
    normalized.startsWith("..") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`Invalid root directory: "${rootDir}"`);
  }
  return normalized;
}

interface DeployJobData {
  deploymentId: string;
  applicationId: string;
  /** When set, overrides app.branch for this deployment only (Deploy from branch). */
  branch?: string;
}

const gitService = new GitService();
const buildService = new BuildService();
const localDockerService = new DockerService();

export function startDeployWorker() {
  const worker = new Worker<DeployJobData>(
    "deploy",
    async (job: Job<DeployJobData>) => {
      const { deploymentId, applicationId, branch: overrideBranch } = job.data;

      const log = (msg: string) => {
        const safe = redactSecrets(msg);
        emitDeployLog(deploymentId, safe);
        appendLog(deploymentId, safe, "build");
      };

      try {
        // 1. Load application data
        log("Loading application configuration...\n");

        const app = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: { domains: true },
        });

        if (!app) throw new Error("Application not found");

        // Decrypt source token for private repos
        const sourceToken = app.sourceToken
          ? decrypt(app.sourceToken)
          : undefined;

        // Resolve docker service (local or remote)
        const { docker: dockerService, isRemote } = await getDockerForServer(
          app.serverId,
        );

        if (isRemote) {
          log(`Deploying to remote server...\n`);
        }

        // Update deployment status
        await updateDeployment(deploymentId, {
          status: "building",
          startedAt: new Date(),
        });
        emitDeployStatus(deploymentId, "building", { applicationId });

        // 2. Clone & Build
        let imageTag: string;
        let commitHash = "latest";
        let commitMessage = "";

        // Decrypt env vars early — needed as build args for frontends
        let envVars: Record<string, string> = {};
        if (app.envVars) {
          envVars = decryptEnvVars(app.envVars);
        }
        const envList = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);

        if (app.sourceType === "docker_image") {
          // Docker image — just pull
          log(`Pulling image: ${app.repositoryUrl}\n`);
          await dockerService.pullImage(app.repositoryUrl!);
          imageTag = app.repositoryUrl!;
        } else if (isRemote) {
          // Remote: clone + build on the remote server
          const remoteDocker = dockerService as RemoteDockerService;
          const remoteBuildPath = `/tmp/deploykit-builds/${deploymentId}`;

          log("Cloning repository on remote server...\n");
          await remoteDocker.gitClone({
            url: app.repositoryUrl!,
            branch: overrideBranch || app.branch || "main",
            destPath: remoteBuildPath,
            token: sourceToken,
            onLog: log,
          });

          // Get commit info
          const commitInfo =
            await remoteDocker.gitGetCommitInfo(remoteBuildPath);
          commitHash = commitInfo.hash;
          commitMessage = commitInfo.message;
          await updateDeployment(deploymentId, { commitHash, commitMessage });
          log(`Commit: ${commitHash} - ${commitMessage}\n`);

          // Resolve context path (monorepo support)
          const remoteContextPath = app.rootDirectory
            ? `${remoteBuildPath}/${safeRootDirectory(app.rootDirectory)}`
            : remoteBuildPath;
          if (app.rootDirectory) {
            log(`Root directory: ${app.rootDirectory}\n`);
          }

          // Build on remote
          const imageName = `deploykit/${app.name}`;
          imageTag = `${imageName}:${commitHash}`;
          log(`\n── Building image on remote server ──────────\n`);

          // Write .env file so frontend frameworks pick up vars at build time
          if (Object.keys(envVars).length > 0) {
            await remoteDocker.writeEnvFile(remoteContextPath, envVars);
          }

          await remoteDocker.buildImage(
            remoteContextPath,
            imageTag,
            app.dockerfilePath || "Dockerfile",
            log,
            // Only explicit build args — runtime env vars are NOT baked into
            // the image (they'd leak via `docker inspect`/frontend bundles).
            // Frontend build-time vars come from the .env file written above.
            app.buildArgs || {},
          );

          // Cleanup build dir
          await remoteDocker.cleanup(remoteBuildPath);
        } else {
          // Local: existing flow
          const repoPath = await gitService.clone({
            url: app.repositoryUrl!,
            branch: overrideBranch || app.branch,
            deploymentId,
            token: sourceToken,
            onLog: log,
          });

          const commitInfo = gitService.getCommitInfo(repoPath);
          commitHash = commitInfo.hash;
          commitMessage = commitInfo.message;
          await updateDeployment(deploymentId, { commitHash, commitMessage });
          log(`Commit: ${commitHash} - ${commitMessage}\n`);

          // Resolve context path (monorepo support)
          const contextPath = app.rootDirectory
            ? path.join(repoPath, safeRootDirectory(app.rootDirectory))
            : repoPath;
          if (app.rootDirectory) {
            log(`Root directory: ${app.rootDirectory}\n`);
          }

          // Write .env file so frontend frameworks (Vite, CRA, Next.js) pick up vars at build time
          if (Object.keys(envVars).length > 0) {
            const envFileContent = Object.entries(envVars)
              .map(([k, v]) => `${k}=${v}`)
              .join("\n");
            writeFileSync(path.join(contextPath, ".env"), envFileContent);
          }

          const imageName = `deploykit/${app.name}`;
          imageTag = await buildService.build({
            contextPath,
            imageName,
            tag: commitHash,
            buildType: app.buildType as BuildType,
            dockerfilePath: app.dockerfilePath || "./Dockerfile",
            // Only explicit build args; runtime secrets are not baked into the
            // image. Frontend build-time vars come from the .env file above.
            buildArgs: app.buildArgs || {},
            port: app.port || undefined,
            startCommand: app.startCommand || undefined,
            onLog: log,
          });
        }

        // 3. Deploy container
        await updateDeployment(deploymentId, { status: "deploying" });
        emitDeployStatus(deploymentId, "deploying", { applicationId });
        log("\n── Deploying ──────────────────────────────────\n");

        // Stop old container
        if (app.containerId) {
          log("Stopping previous container...\n");
          try {
            await dockerService.stopAndRemove(app.containerId);
          } catch {
            log("Previous container not found, skipping.\n");
          }
        }

        const containerName = `dk-${app.name}`;

        // Build domain config for Traefik
        const appDomains = (app.domains || []).map((d) => ({
          domain: d.domain,
          https: d.https,
          port: d.port,
        }));

        // Parse persistent volumes
        const appVolumes = (app.volumes as string[]) || [];
        if (appVolumes.length > 0) {
          log(`Volumes: ${appVolumes.join(", ")}\n`);
        }

        let containerId: string;

        if (appDomains.length > 0) {
          containerId = await dockerService.deployApp({
            name: containerName,
            image: imageTag,
            env: envList,
            port: app.port || 3000,
            domains: appDomains,
            volumes: appVolumes.length > 0 ? appVolumes : undefined,
            labels: {
              "deploykit.project": app.projectId,
              "deploykit.service": app.id,
              "deploykit.deployment": deploymentId,
              "deploykit.commit": commitHash,
            },
          });
        } else {
          containerId = await dockerService.createAndStart({
            name: containerName,
            image: imageTag,
            env: envList,
            networkName: "deploykit-network",
            ports: app.port ? [{ host: app.port, container: app.port }] : [],
            volumes: appVolumes.length > 0 ? appVolumes : undefined,
            labels: {
              "deploykit.managed": "true",
              "deploykit.project": app.projectId,
              "deploykit.service": app.id,
              "deploykit.deployment": deploymentId,
            },
          });
        }

        log(`Container started: ${containerId}\n`);

        // 4. Health check
        log("\n── Health check ───────────────────────────────\n");
        const hcResult = await healthCheck({
          type: app.healthCheckType ?? "http",
          path: app.healthCheckPath ?? "/",
          timeout: app.healthCheckTimeout ?? 5,
          interval: app.healthCheckInterval ?? 10,
          retries: app.healthCheckRetries ?? 6,
          required: app.healthCheckRequired ?? false,
          domains: appDomains,
          port: app.port ?? undefined,
          containerId,
          log,
        });

        if (!hcResult.passed) {
          if (hcResult.required) {
            throw new Error(
              `Health check failed after ${hcResult.attempts} attempt(s): ${hcResult.lastError}`,
            );
          }
          log(
            `⚠️  Health check failed — container is running but may not be ready.\n`,
          );
        } else {
          log(
            `✓ Health check passed (${hcResult.attempts} attempt(s), ${hcResult.durationMs}ms).\n`,
          );
        }

        // 5. Update records
        await db
          .update(applications)
          .set({
            containerId,
            containerImage: imageTag,
            status: "running",
            updatedAt: new Date(),
          })
          .where(eq(applications.id, applicationId));

        await updateDeployment(deploymentId, {
          status: "success",
          imageName: imageTag,
          finishedAt: new Date(),
        });

        emitDeployStatus(deploymentId, "success", {
          applicationId,
          containerId,
        });

        log("\n══════════════════════════════════════════════\n");
        log("✓ Deployment successful!\n");
        if (appDomains.length > 0) {
          for (const d of appDomains) {
            const protocol = d.https ? "https" : "http";
            log(`  → ${protocol}://${d.domain}\n`);
          }
        }
        log("══════════════════════════════════════════════\n");

        // Notify external channels
        fireNotification({
          event: "deploy.success",
          projectId: app.projectId,
          title: `Deploy succeeded: ${app.name}`,
          message: `${app.name} deployed successfully${commitHash !== "latest" ? ` (${commitHash})` : ""}.`,
          meta: {
            applicationId: app.id,
            applicationName: app.name,
            deploymentId,
            commitHash: commitHash !== "latest" ? commitHash : undefined,
            branch: overrideBranch || app.branch,
          },
        }).catch(() => {}); // fire-and-forget

        // Cleanup (local only)
        if (!isRemote && app.sourceType !== "docker_image") {
          gitService.cleanup(deploymentId);
        }
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
          .update(applications)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(applications.id, applicationId));

        emitDeployStatus(deploymentId, "failed", {
          applicationId,
          error: errorMsg,
        });

        // Notify external channels
        try {
          const failedApp = await db.query.applications.findFirst({
            where: eq(applications.id, applicationId),
          });
          if (failedApp) {
            fireNotification({
              event: "deploy.failed",
              projectId: failedApp.projectId,
              title: `Deploy failed: ${failedApp.name}`,
              message: `Deployment of ${failedApp.name} failed: ${errorMsg}`,
              meta: {
                applicationId: failedApp.id,
                applicationName: failedApp.name,
                deploymentId,
                branch: overrideBranch || failedApp.branch,
                error: errorMsg,
              },
            }).catch(() => {});
          }
        } catch {
          // Notification failure is non-fatal
        }

        try {
          gitService.cleanup(deploymentId);
        } catch (cleanupErr: any) {
          console.error(
            `[deploy] Cleanup failed for ${deploymentId}:`,
            cleanupErr.message,
          );
        }
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 2,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 20 },
    },
  );

  worker.on("completed", (job) => {
    console.log(`[deploy-worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[deploy-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[deploy-worker] Worker started, waiting for jobs...");
  return worker;
}

async function updateDeployment(
  id: string,
  data: Partial<typeof deployments.$inferInsert>,
) {
  await db.update(deployments).set(data).where(eq(deployments.id, id));
}

async function appendLog(
  deploymentId: string,
  log: string,
  type: "build" | "deploy",
) {
  const field = type === "build" ? "buildLogs" : "deployLogs";
  const current = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    columns: { [field]: true },
  });

  const currentLog = (current as any)?.[field] || "";
  await db
    .update(deployments)
    .set({ [field]: currentLog + log })
    .where(eq(deployments.id, deploymentId));
}

interface HealthCheckOpts {
  type: string; // "http" | "tcp" | "none"
  path: string; // HTTP path, e.g. "/health"
  timeout: number; // seconds per attempt
  interval: number; // seconds between attempts
  retries: number; // max attempts
  required: boolean; // fail deploy if check fails
  domains: Array<{ domain: string; https: boolean; port: number }>;
  port?: number; // app port for TCP fallback
  containerId: string;
  log: (msg: string) => void;
}

interface HealthCheckResult {
  passed: boolean;
  required: boolean;
  attempts: number;
  durationMs: number;
  lastError?: string;
}

async function healthCheck(opts: HealthCheckOpts): Promise<HealthCheckResult> {
  const { type, log } = opts;
  const start = Date.now();

  if (type === "none") {
    log("Health check disabled, skipping.\n");
    return { passed: true, required: false, attempts: 0, durationMs: 0 };
  }

  // Initial wait — give the container a moment to start its process
  const initialWait = Math.min(opts.interval * 1000, 5000);
  log(`Waiting ${initialWait / 1000}s for container to initialize…\n`);
  await sleep(initialWait);

  if (type === "tcp") {
    return runTcpCheck(opts, start);
  }

  // HTTP — prefer domain URL, fall back to localhost:port
  return runHttpCheck(opts, start);
}

async function runTcpCheck(
  opts: HealthCheckOpts,
  start: number,
): Promise<HealthCheckResult> {
  const { log, timeout, interval, retries, required, domains, port } = opts;

  // Resolve host:port — prefer first domain port, then app.port
  const host = domains[0]?.domain ?? "localhost";
  const checkPort = domains[0]?.port ?? port;

  if (!checkPort) {
    log("No port configured for TCP health check — skipping.\n");
    return { passed: true, required: false, attempts: 0, durationMs: 0 };
  }

  log(`TCP check → ${host}:${checkPort}\n`);

  let lastError = "";
  for (let attempt = 1; attempt <= retries; attempt++) {
    log(`  Attempt ${attempt}/${retries}…\n`);
    try {
      await tcpConnect(host, checkPort, timeout * 1000);
      const durationMs = Date.now() - start;
      log(`  ✓ TCP connection established.\n`);
      return { passed: true, required, attempts: attempt, durationMs };
    } catch (err: any) {
      lastError = err.message ?? "Connection refused";
      log(`  → ${lastError}\n`);
    }
    if (attempt < retries) await sleep(interval * 1000);
  }

  return {
    passed: false,
    required,
    attempts: retries,
    durationMs: Date.now() - start,
    lastError,
  };
}

function tcpConnect(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { createConnection } = require("net") as typeof import("net");
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP connect timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runHttpCheck(
  opts: HealthCheckOpts,
  start: number,
): Promise<HealthCheckResult> {
  const { log, path, timeout, interval, retries, required, domains, port } =
    opts;

  // Build URL: prefer first domain, fall back to localhost:port
  let url: string;
  if (domains.length > 0) {
    const d = domains[0]!;
    const proto = d.https ? "https" : "http";
    const normalPath = path.startsWith("/") ? path : `/${path}`;
    url = `${proto}://${d.domain}${normalPath}`;
  } else if (port) {
    const normalPath = path.startsWith("/") ? path : `/${path}`;
    url = `http://localhost:${port}${normalPath}`;
  } else {
    log("No domain or port configured for HTTP health check — skipping.\n");
    return { passed: true, required: false, attempts: 0, durationMs: 0 };
  }

  log(`HTTP check → ${url}\n`);

  let lastError = "";
  for (let attempt = 1; attempt <= retries; attempt++) {
    log(`  Attempt ${attempt}/${retries}: GET ${url}\n`);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout * 1000),
        // Don't follow redirects — a redirect itself means the server is up
        redirect: "manual",
      });

      // Accept 2xx and 3xx as "up". 4xx/5xx indicate the app is broken or
      // misconfigured, not just "reachable".
      if (response.status >= 200 && response.status < 400) {
        const durationMs = Date.now() - start;
        log(`  ✓ HTTP ${response.status} — container is ready.\n`);
        return { passed: true, required, attempts: attempt, durationMs };
      }

      lastError = `HTTP ${response.status}`;
      log(`  → ${lastError} (expected 2xx/3xx)\n`);
    } catch (err: any) {
      lastError = err.message ?? "Connection failed";
      log(`  → ${lastError}\n`);
    }
    if (attempt < retries) {
      log(`  Waiting ${interval}s before next attempt…\n`);
      await sleep(interval * 1000);
    }
  }

  return {
    passed: false,
    required,
    attempts: retries,
    durationMs: Date.now() - start,
    lastError,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
