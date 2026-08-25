import { z } from "zod";
import { eq } from "drizzle-orm";

import { servers } from "../db/schema/index";

import {
  sshTestConnection,
  sshDockerHealthCheck,
  sshGetServerInfo,
  sshInstallDocker,
} from "../services/ssh";
import { resolveSshOpts } from "../services/ssh-key-resolver";
import {
  router,
  protectedProcedure,
  operatorProcedure,
  adminProcedure,
} from "../trpc";

import { logAction } from "../lib/audit/audit";

import { createServerSchema } from "@deploykit/shared";

// Base shape so tRPC infers a single type instead of a union
const emptyHealthResult = {
  status: "error" as "connected" | "disconnected" | "error",
  dockerInstalled: false,
  dockerVersion: undefined as string | undefined,
  containers: undefined as number | undefined,
  images: undefined as number | undefined,
  cpuCores: undefined as number | undefined,
  totalMemory: undefined as number | undefined,
  totalDisk: undefined as number | undefined,
  os: undefined as string | undefined,
  error: undefined as string | undefined,
};

export const serverRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.servers.findMany({
      with: {
        // Metadata only — the private half never leaves the API.
        sshKey: {
          columns: { id: true, name: true, type: true, fingerprint: true },
        },
        applications: {
          columns: {
            id: true,
            name: true,
            status: true,
            projectId: true,
          },
        },
        databases: {
          columns: {
            id: true,
            name: true,
            status: true,
            type: true,
            projectId: true,
          },
        },
      },
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: eq(servers.id, input.id),
        with: {
          sshKey: {
            columns: { id: true, name: true, type: true, fingerprint: true },
          },
        },
      });
      if (!server) throw new Error("Server not found");
      return server;
    }),

  create: adminProcedure
    .input(createServerSchema)
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db.insert(servers).values(input).returning();
      await logAction(ctx, {
        action: "server.create",
        resourceType: "server",
        resourceId: server!.id,
        resourceName: server!.name,
        metadata: { host: server!.host, username: server!.username },
      });
      return server!;
    }),

  createLocal: adminProcedure.mutation(async ({ ctx }) => {
    const existing = await ctx.db.query.servers.findFirst({
      where: eq(servers.isLocal, true),
    });
    if (existing) return existing;

    const [server] = await ctx.db
      .insert(servers)
      .values({
        name: "Local Server",
        host: "localhost",
        port: 22,
        username: "root",
        isLocal: true,
        status: "connected",
      })
      .returning();
    await logAction(ctx, {
      action: "server.create",
      resourceType: "server",
      resourceId: server!.id,
      resourceName: "Local Server",
      metadata: { isLocal: true },
    });
    return server!;
  }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        host: z.string().min(1).max(255).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        username: z.string().max(100).optional(),
        sshKeyId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [server] = await ctx.db
        .update(servers)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(servers.id, id))
        .returning();
      await logAction(ctx, {
        action: "server.update",
        resourceType: "server",
        resourceId: server!.id,
        resourceName: server!.name,
        metadata: { ...data },
      });
      return server!;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: eq(servers.id, input.id),
      });
      await ctx.db.delete(servers).where(eq(servers.id, input.id));
      await logAction(ctx, {
        action: "server.delete",
        resourceType: "server",
        resourceId: input.id,
        resourceName: server?.name,
      });
      return { success: true };
    }),

  testConnection: operatorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: eq(servers.id, input.id),
      });
      if (!server) throw new Error("Server not found");
      if (server.isLocal) return { success: true, message: "Local server" };

      return sshTestConnection(await resolveSshOpts(server));
    }),

  healthCheck: operatorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: eq(servers.id, input.id),
      });
      if (!server) throw new Error("Server not found");

      if (server.isLocal) {
        try {
          const { docker } = await import("../lib/docker");
          await docker.ping();
          await ctx.db
            .update(servers)
            .set({
              status: "connected",
              lastHealthCheck: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(servers.id, input.id));
          return {
            ...emptyHealthResult,
            status: "connected" as const,
            dockerInstalled: true,
            dockerVersion: "local",
          };
        } catch {
          await ctx.db
            .update(servers)
            .set({ status: "error", updatedAt: new Date() })
            .where(eq(servers.id, input.id));
          return {
            ...emptyHealthResult,
            error: "Docker not reachable",
          };
        }
      }

      // Remote server via SSH
      const sshOpts = await resolveSshOpts(server);

      const dockerCheck = await sshDockerHealthCheck(sshOpts);

      // SSH failed entirely
      if (!dockerCheck.connected) {
        await ctx.db
          .update(servers)
          .set({
            status: "error",
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(servers.id, input.id));
        return {
          ...emptyHealthResult,
          error: dockerCheck.error,
        };
      }

      // SSH works — get server info regardless of Docker status
      const info = await sshGetServerInfo(sshOpts);

      const newStatus =
        dockerCheck.dockerInstalled && dockerCheck.dockerVersion
          ? "connected"
          : "disconnected";

      await ctx.db
        .update(servers)
        .set({
          status: newStatus,
          dockerVersion: dockerCheck.dockerVersion || null,
          totalCpu: info.cpuCores || null,
          totalMemory: info.totalMemory || null,
          totalDisk: info.totalDisk || null,
          lastHealthCheck: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(servers.id, input.id));

      return {
        ...emptyHealthResult,
        status: newStatus as "connected" | "disconnected" | "error",
        dockerInstalled: dockerCheck.dockerInstalled,
        dockerVersion: dockerCheck.dockerVersion,
        containers: dockerCheck.containers,
        images: dockerCheck.images,
        cpuCores: info.cpuCores,
        totalMemory: info.totalMemory,
        totalDisk: info.totalDisk,
        os: info.os,
        error: dockerCheck.error,
      };
    }),

  installDocker: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: eq(servers.id, input.id),
      });
      if (!server) throw new Error("Server not found");
      if (server.isLocal)
        throw new Error("Cannot install Docker on local server from here");

      const sshOpts = await resolveSshOpts(server);

      const result = await sshInstallDocker(sshOpts);

      if (result.success) {
        await ctx.db
          .update(servers)
          .set({
            status: "connected",
            dockerVersion: result.version || null,
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(servers.id, input.id));
      }

      return result;
    }),

  pruneImages: adminProcedure
    .input(
      z.object({
        serverId: z.string().uuid().nullable(), // null = local
        keep: z.number().int().min(1).max(20).default(3),
        dryRun: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const { pruneServerImages } = await import("../services/image-cleaner");
      return pruneServerImages({
        serverId: input.serverId,
        keep: input.keep,
        dryRun: input.dryRun,
      });
    }),

  pruneImagesAll: adminProcedure
    .input(
      z.object({
        keep: z.number().int().min(1).max(20).default(3),
        dryRun: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const { pruneAllServers } = await import("../services/image-cleaner");
      return pruneAllServers({ keep: input.keep, dryRun: input.dryRun });
    }),
});
