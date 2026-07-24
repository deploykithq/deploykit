import { Worker, type Job } from "bullmq";
import path from "path";
import { writeFileSync } from "fs";
import { eq, sql } from "drizzle-orm";

import { db } from "../db/index";
import { applications, deployments } from "../db/schema/index";

import { GitService } from "../services/git";
import { BuildService } from "../services/build";
import { DockerService } from "../services/docker";
import { fireNotification } from "../services/notifier";
import { getDockerForServer } from "../services/docker-factory";
import { RemoteDockerService } from "../services/remote-docker";
import { scanImage, scanConfig } from "../services/trivy-scanner";

import { redis } from "../lib/redis";
import { autoMapImageVolumes } from "../lib/volumes";
import { acquireDeployLock, releaseDeployLock } from "../lib/deploy-lock";
import { redactSecrets } from "../lib/redact";
import { decrypt, decryptEnvVars } from "../lib/encryption";
import { emitDeployLog, emitDeployStatus } from "../lib/socket";

import type { BuildType } from "@deploykit/shared";

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

export const startDeployWorker = () => {
  const worker = new Worker<DeployJobData>(
    "deploy",
    async (job: Job<DeployJobData>) => {
      const { deploymentId, applicationId, branch: overrideBranch } = job.data;

      const log = (msg: string) => {
        const safe = redactSecrets(msg);
        emitDeployLog(deploymentId, safe);
        // Fire-and-forget by design; a rejected floating promise would crash
        // the process, so swallow DB hiccups here.
        appendLog(deploymentId, safe, "build").catch(() => {});
      };

      try {
        // Serialize deploys per app: a concurrent execution would remove this
        // one's freshly started container (and vice versa). Queued jobs wait
        // here until the in-flight deploy finishes.
        await acquireDeployLock(applicationId, deploymentId, () =>
          log(
            "Another deployment of this application is in progress — waiting for it to finish...\n",
          ),
        );

        // Load application data
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

        // Clone & Build
        let imageTag: string;
        let commitHash = "latest";
        let commitMessage = "";

        // Decrypt env vars early — needed as build args for frontends
        let envVars: Record<string, string> = {};
        if (app.envVars) {
          envVars = decryptEnvVars(app.envVars);
        }

        if (app.sourceType === "docker_image") {
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

        // Vulnerability scan (advisory — never blocks the deploy).
        // Resolve per-app toggle, falling back to the global SCAN_ENABLED default.
        const scanEnabled = app.scanEnabled ?? scanConfig.enabledByDefault;
        if (!scanEnabled) {
          // leave scan columns null
        } else if (isRemote) {
          // Local-first: the image lives on the remote daemon, out of reach here.
          await updateDeployment(deploymentId, { scanStatus: "skipped" });
          log("\nVulnerability scan skipped (remote server).\n");
        } else {
          log("\n── Scanning image for vulnerabilities ──────\n");
          await updateDeployment(deploymentId, { scanStatus: "scanning" });
          try {
            const res = await scanImage({
              imageTag,
              onLog: log,
              timeoutMs: scanConfig.timeoutMs,
            });
            const s = res.summary;
            log(
              `Scan: ${s.critical} critical, ${s.high} high, ${s.medium} medium, ${s.low} low\n`,
            );
            await updateDeployment(deploymentId, {
              scanStatus: res.status,
              scanResults: { summary: s, top: res.top, scannedAt: Date.now() },
              scanFinishedAt: new Date(),
            });
          } catch (scanErr: any) {
            // Advisory: a scan failure must not abort the deploy.
            log(`Vulnerability scan errored: ${scanErr.message}\n`);
            await updateDeployment(deploymentId, {
              scanStatus: "error",
              scanFinishedAt: new Date(),
            });
          }
        }

        // Deploy container
        await updateDeployment(deploymentId, { status: "deploying" });
        emitDeployStatus(deploymentId, "deploying", { applicationId });
        log("\n── Deploying ──────────────────────────────────\n");

        // The clone/build/scan above can take minutes. Re-read the row so
        // config edits saved meanwhile (volumes, domains, env, limits) apply
        // to the container we are about to start — deploying the stale
        // snapshot silently drops them until the *next* deploy.
        const cfg = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: { domains: true },
        });
        if (!cfg) {
          throw new Error(
            "Application was deleted while the deployment was running",
          );
        }

        const runtimeEnvList = cfg.envVars
          ? Object.entries(decryptEnvVars(cfg.envVars)).map(
              ([k, v]) => `${k}=${v}`,
            )
          : [];

        // Stop old container(s). Remove every replica of this service by label so a scale-down doesn't leave orphans behind.
        log("Stopping previous container(s)...\n");
        try {
          await dockerService.removeServiceContainers(cfg.id);
        } catch (removeErr: any) {
          log(
            `Warning: could not remove previous container(s): ${removeErr?.message ?? removeErr}\n`,
          );
        }

        const containerName = `dk-${cfg.name}`;

        // Build domain config for Traefik
        const appDomains = (cfg.domains || []).map((d) => ({
          domain: d.domain,
          https: d.https,
          port: d.port,
        }));

        // Parse persistent volumes
        const appVolumes = [...((cfg.volumes as string[]) || [])];

        // Cover the image's declared `VOLUME` paths with deterministic named
        // volumes. Left to the daemon, each declared path gets a brand-new
        // anonymous volume per deploy, so its data appears erased after every
        // redeploy. Advisory: an inspect failure must not abort the deploy.
        try {
          const declared = await dockerService.getImageVolumes(imageTag);
          const autoMapped = autoMapImageVolumes(cfg.name, declared, appVolumes);
          for (const vol of autoMapped) {
            log(`Auto-mapped image volume: ${vol}\n`);
          }
          appVolumes.push(...autoMapped);
        } catch (volErr: any) {
          log(
            `Warning: could not inspect image volumes: ${volErr?.message ?? volErr}\n`,
          );
        }

        if (appVolumes.length > 0) {
          log(`Volumes: ${appVolumes.join(", ")}\n`);
        }

        let containerId: string;

        // Images built by us (Dockerfile/Nixpacks/Buildpacks) live only in the
        // local image store — never pull them, or the daemon tries a registry
        // pull of "deploykit/<name>" and fails with "pull access denied".
        // For docker_image sources the image was already pulled above.
        const skipPull = app.sourceType !== "docker_image";

        const cpuMillicores = cfg.cpuLimit ?? undefined;
        const memoryMb = cfg.memoryLimit ?? undefined;

        if (appDomains.length > 0) {
          // Replicas only work behind Traefik (it load-balances containers
          // sharing one service); cap at the configured count.
          const replicas = Math.max(1, cfg.replicas ?? 1);
          if (replicas > 1) log(`Replicas: ${replicas}\n`);
          containerId = await dockerService.deployApp({
            name: containerName,
            image: imageTag,
            env: runtimeEnvList,
            port: cfg.port || 3000,
            domains: appDomains,
            volumes: appVolumes.length > 0 ? appVolumes : undefined,
            skipPull,
            replicas,
            cpuMillicores,
            memoryMb,
            labels: {
              "deploykit.project": cfg.projectId,
              "deploykit.service": cfg.id,
              "deploykit.deployment": deploymentId,
              "deploykit.commit": commitHash,
            },
          });
        } else {
          // No domain → a fixed host port is published, which a second
          // replica can't bind. Force a single instance.
          if ((cfg.replicas ?? 1) > 1) {
            log("Replicas require a domain; deploying a single instance.\n");
          }
          containerId = await dockerService.createAndStart({
            name: containerName,
            image: imageTag,
            env: runtimeEnvList,
            networkName: "deploykit-network",
            ports: cfg.port ? [{ host: cfg.port, container: cfg.port }] : [],
            volumes: appVolumes.length > 0 ? appVolumes : undefined,
            skipPull,
            cpuMillicores,
            memoryMb,
            labels: {
              "deploykit.managed": "true",
              "deploykit.project": cfg.projectId,
              "deploykit.service": cfg.id,
              "deploykit.deployment": deploymentId,
            },
          });
        }

        log(`Container started: ${containerId}\n`);

        // Trust but verify: the "Volumes:" line above only echoes the DB
        // config. Inspect the real container so a missing mount fails the
        // deploy loudly instead of silently sending uploads to container FS
        // (where the next redeploy destroys them).
        if (appVolumes.length > 0) {
          const mounts = await dockerService.getContainerMounts(containerId);
          for (const m of mounts) {
            log(
              `Mount applied: ${m.name ?? m.source} -> ${m.destination}${m.rw ? "" : " (ro)"}\n`,
            );
          }
          const missing = appVolumes.filter((vol) => {
            const [source, destination] = vol.split(":");
            return !mounts.some(
              (m) =>
                m.destination === destination &&
                (m.source === source || m.name === source),
            );
          });
          if (missing.length > 0) {
            throw new Error(
              `Persistent volume(s) not applied to the container: ${missing.join(", ")}`,
            );
          }
          log("✓ Persistent volumes verified on the running container.\n");
        }

        // Health check
        log("\n── Health check ───────────────────────────────\n");
        const hcResult = await healthCheck({
          type: cfg.healthCheckType ?? "http",
          path: cfg.healthCheckPath ?? "/",
          timeout: cfg.healthCheckTimeout ?? 5,
          interval: cfg.healthCheckInterval ?? 10,
          retries: cfg.healthCheckRetries ?? 6,
          required: cfg.healthCheckRequired ?? false,
          domains: appDomains,
          port: cfg.port ?? undefined,
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
            `⚠️ Health check failed — container is running but may not be ready.\n`,
          );
        } else {
          log(
            `✓ Health check passed (${hcResult.attempts} attempt(s), ${hcResult.durationMs}ms).\n`,
          );
        }

        // Update records
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
          projectId: cfg.projectId,
          title: `Deploy succeeded: ${cfg.name}`,
          message: `${cfg.name} deployed successfully${commitHash !== "latest" ? ` (${commitHash})` : ""}.`,
          meta: {
            applicationId: cfg.id,
            applicationName: cfg.name,
            deploymentId,
            commitHash: commitHash !== "latest" ? commitHash : undefined,
            branch: overrideBranch || cfg.branch,
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
      } finally {
        await releaseDeployLock(applicationId, deploymentId);
      }
    },
    {
      connection: redis,
      concurrency: 2,
      // Survive long event-loop stalls without losing the job lock — a lost
      // lock makes BullMQ re-run the job in parallel with its still-running
      // first execution (observed as two interleaved builds in one
      // deployment's logs).
      lockDuration: 120_000,
      stalledInterval: 60_000,
      // A stalled job must fail loudly, never be silently re-run.
      maxStalledCount: 0,
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

  worker.on("stalled", (jobId) => {
    console.warn(
      `[deploy-worker] Job ${jobId} stalled (lock lost — likely a blocked event loop); marking it failed instead of re-running`,
    );
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
  // Append in SQL, not in JS: log() fires these without awaiting, and a
  // read-modify-write here silently drops chunks when two appends overlap.
  const field = type === "build" ? "buildLogs" : "deployLogs";
  const column = type === "build" ? deployments.buildLogs : deployments.deployLogs;
  await db
    .update(deployments)
    .set({ [field]: sql`coalesce(${column}, '') || ${log}` })
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
