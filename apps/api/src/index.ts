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
import { startAutoscaleScheduler } from "./workers/autoscale.scheduler";
import { startImageCleanupScheduler } from "./workers/image-cleanup.scheduler";
import { startAuditCleanupScheduler } from "./workers/audit-cleanup.scheduler";
import { WebhookService } from "./services/webhook";
import { startLogStream, stopLogStream } from "./services/logs";

const PORT = parseInt(process.env.API_PORT || "3001", 10);
const webhookService = new WebhookService();

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > maxRequests;
}

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 300_000);

async function main() {
  // Create HTTP server first, then attach Fastify + Socket.IO
  const httpServer = createServer();

  const server = Fastify({
    logger: true,
    serverFactory: (handler) => {
      httpServer.on("request", handler);
      return httpServer;
    },
  });

  // Socket.IO (attach before Fastify starts)
  const io = initSocket(httpServer);

  io.on("connection", (socket) => {
    socket.on("subscribe:logs", async (containerId: string) => {
      socket.join(`logs:${containerId}`);
      try {
        await startLogStream(containerId);
      } catch {
        // Container might not exist
      }
    });

    socket.on("unsubscribe:logs", (containerId: string) => {
      socket.leave(`logs:${containerId}`);
      const room = io.sockets.adapter.rooms.get(`logs:${containerId}`);
      if (!room || room.size === 0) {
        stopLogStream(containerId);
      }
    });
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
    done(null, payload);
  });

  // Rate limiting for auth endpoints
  server.addHook("onRequest", (req, reply, done) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip;

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
      if (isRateLimited(`global:${ip}`, 200, 60_000)) {
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
      if (isRateLimited(`auth:${ip}`, 10, 60_000)) {
        reply
          .status(429)
          .send({ error: "Too many attempts. Try again later." });
        return;
      }
    }

    // Webhook limit: 30 requests/min per IP
    if (req.url.startsWith("/api/webhooks")) {
      if (isRateLimited(`webhook:${ip}`, 30, 60_000)) {
        reply.status(429).send({ error: "Too many webhook requests." });
        return;
      }
    }

    done();
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
      const result = await webhookService.handleGeneric(req.body);
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
  startAutoscaleScheduler();
  startImageCleanupScheduler();
  startAuditCleanupScheduler();
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
