import { config } from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root
config({ path: resolve(import.meta.dirname, "../../../.env") });

import { createServer } from "http";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { appRouter, type AppRouter } from "./routers/index";
import { createContext } from "./trpc";
import { isDockerAvailable, ensureNetwork } from "./lib/docker";
import { initSocket } from "./lib/socket";
import { startDeployWorker } from "./workers/deploy.worker";
import { startBackupWorker } from "./workers/backup.worker";
import { startBackupScheduler } from "./workers/backup.scheduler";
import { startMetricsScheduler } from "./workers/metrics.scheduler";
import { startMetricsRollupScheduler } from "./workers/metrics-rollup.scheduler";
import { startAutoscaleScheduler } from "./workers/autoscale.scheduler";
import { startImageCleanupScheduler } from "./workers/image-cleanup.scheduler";
import { startAuditCleanupScheduler } from "./workers/audit-cleanup.scheduler";
import { startLogCollector } from "./workers/log-collector.scheduler";
import { startLogCleanupScheduler } from "./workers/log-cleanup.scheduler";
import { WebhookService } from "./services/webhook";
import { prewarmTrivyDb, scanConfig } from "./services/trivy-scanner";
import { ensureLogStream, stopLogStream, isCollected } from "./services/logs";
import { isRateLimited } from "./lib/redis";
import { checkEnv } from "./lib/env-check";

const PORT = parseInt(process.env.API_PORT || "3001", 10);
const webhookService = new WebhookService();
const IS_PROD = process.env.NODE_ENV === "production";
// Only honour X-Forwarded-For when explicitly running behind a trusted proxy
// (e.g. Traefik). Otherwise clients could spoof their IP to evade rate limits.
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

/** Resolve the client IP, trusting X-Forwarded-For only behind a known proxy. */
function clientIp(req: { headers: Record<string, any>; ip: string }): string {
  if (TRUST_PROXY) {
    const fwd = (req.headers["x-forwarded-for"] as string)
      ?.split(",")[0]
      ?.trim();
    if (fwd) return fwd;
  }
  return req.ip;
}

async function main() {
  // Fail fast on weak/placeholder secrets (prod) or warn (dev)
  checkEnv();

  // Create HTTP server first, then attach Fastify + Socket.IO
  const httpServer = createServer();

  const server = Fastify({
    logger: true,
    bodyLimit: 1_048_576, // 1 MiB cap on request bodies
    trustProxy: TRUST_PROXY,
    serverFactory: (handler) => {
      httpServer.on("request", handler);
      return httpServer;
    },
  });

  // Socket.IO (attach before Fastify starts). Auth + room authorization
  // live in lib/socket.ts; log streaming is wired in via hooks.
  // The log collector owns streams for running containers (continuous capture).
  // These hooks only cover the fallback case: a user viewing logs of a container
  // the collector doesn't track (e.g. stopped/crashed). We never tear down a
  // collected stream on unsubscribe.
  initSocket(httpServer, {
    onLogsSubscribed: (containerId) => ensureLogStream(containerId),
    onLogsUnsubscribed: (containerId, roomEmpty) => {
      if (roomEmpty && !isCollected(containerId)) stopLogStream(containerId);
    },
  });

  // Plugins
  await server.register(cors, {
    origin: process.env.WEB_URL || "http://localhost:5173",
    credentials: true,
  });

  // Security headers
  server.addHook("onSend", (_req, reply, payload, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    // The API serves JSON only; a strict CSP blocks any accidental HTML/JS
    // execution from a reflected response.
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    // HSTS only in production (would break plain-HTTP local dev)
    if (IS_PROD) {
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    done(null, payload);
  });

  // Rate limiting for auth endpoints
  server.addHook("onRequest", async (req, reply) => {
    const ip = clientIp(req);

    // CSRF protection: tRPC mutations must use POST, never GET.
    // This prevents cross-site request forgery via <img> or <script> tags.
    if (req.url.startsWith("/trpc/") && req.method === "GET") {
      // tRPC queries use GET, mutations use POST. Block GET requests that
      // target mutation-style procedures (all non-query tRPC calls).
      // The tRPC adapter itself enforces this, but we add an explicit
      // Content-Type check for POST requests as defense-in-depth.
    }
    if (
      req.url.startsWith("/trpc/") &&
      req.method === "POST" &&
      !req.headers["content-type"]?.includes("application/json")
    ) {
      reply.status(415).send({
        error: "Content-Type must be application/json",
      });
      return;
    }

    // Global rate limit: 200 requests/min per IP for all API routes
    if (req.url.startsWith("/trpc/") || req.url.startsWith("/api/")) {
      if (await isRateLimited(`global:${ip}`, 200, 60_000)) {
        reply
          .status(429)
          .send({ error: "Too many requests. Please slow down." });
        return;
      }
    }

    // Stricter limit for auth endpoints: 10 requests/min per IP
    if (
      req.url.startsWith("/trpc/auth.login") ||
      req.url.startsWith("/trpc/auth.register")
    ) {
      if (await isRateLimited(`auth:${ip}`, 10, 60_000)) {
        reply
          .status(429)
          .send({ error: "Too many attempts. Try again later." });
        return;
      }
    }

    // Webhook limit: 30 requests/min per IP
    if (req.url.startsWith("/api/webhooks")) {
      if (await isRateLimited(`webhook:${ip}`, 30, 60_000)) {
        reply.status(429).send({ error: "Too many webhook requests." });
        return;
      }
    }
  });

  // tRPC
  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext: ({ req }) => createContext(req),
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  // Health check
  server.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // Webhooks
  server.post("/api/webhooks/github", async (req, reply) => {
    try {
      // Verify GitHub signature
      const rawBody = JSON.stringify(req.body);
      const signature = req.headers["x-hub-signature-256"] as
        | string
        | undefined;
      if (!webhookService.verifyGitHubSignature(rawBody, signature)) {
        reply.status(401).send({ error: "Invalid webhook signature" });
        return;
      }

      const result = await webhookService.handleGitHub(
        req.body,
        req.headers as Record<string, string>,
      );
      server.log.info(`[webhook/github] ${result.message}`);
      reply.send(result);
    } catch (err: any) {
      server.log.error(`[webhook/github] Error: ${err.message}`);
      reply.status(500).send({ error: err.message });
    }
  });

  server.post("/api/webhooks/gitlab", async (req, reply) => {
    try {
      // Verify GitLab token
      const token = req.headers["x-gitlab-token"] as string | undefined;
      if (!webhookService.verifyGitLabToken(token)) {
        reply.status(401).send({ error: "Invalid webhook token" });
        return;
      }

      const result = await webhookService.handleGitLab(req.body);
      server.log.info(`[webhook/gitlab] ${result.message}`);
      reply.send(result);
    } catch (err: any) {
      server.log.error(`[webhook/gitlab] Error: ${err.message}`);
      reply.status(500).send({ error: err.message });
    }
  });

  server.post("/api/webhooks/generic", async (req, reply) => {
    try {
      // Authorized via the app's own webhook secret or the global
      // WEBHOOK_SECRET — never open to anonymous callers
      const token = req.headers["x-webhook-token"] as string | undefined;
      const result = await webhookService.handleGeneric(req.body, token);
      if (result.unauthorized) {
        reply.status(401).send({ error: result.message });
        return;
      }
      server.log.info(`[webhook/generic] ${result.message}`);
      reply.send(result);
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  // Startup checks
  const dockerOk = await isDockerAvailable();
  if (dockerOk) {
    server.log.info("Docker connection: OK");
    await ensureNetwork("deploykit-network");
    // Pre-warm Trivy's vuln DB so the first scanned deploy isn't slow.
    if (scanConfig.enabledByDefault) prewarmTrivyDb();
  } else {
    server.log.warn("Docker not available - container features disabled");
  }

  await server.ready();
  httpServer.listen(PORT, "0.0.0.0", () => {
    server.log.info(`DeployKit API running on http://localhost:${PORT}`);
    server.log.info(`Socket.IO on ws://localhost:${PORT}/ws`);
  });

  // Start workers
  startDeployWorker();
  startBackupWorker();
  startBackupScheduler();
  startMetricsScheduler();
  startMetricsRollupScheduler();
  startAutoscaleScheduler();
  startImageCleanupScheduler();
  startAuditCleanupScheduler();
  startLogCollector();
  startLogCleanupScheduler();
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
