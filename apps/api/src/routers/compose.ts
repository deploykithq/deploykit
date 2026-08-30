import { z } from "zod";
import { eq, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "../trpc";

import {
  composeServices,
  composeDomains,
  deployments,
} from "../db/schema/index";

import {
  getProjectRole,
  getProjectRoleByComposeId,
  getAccessibleProjectIds,
  canOperate,
  isAdmin,
  canViewSecrets,
} from "../lib/permissions";
import { logAction } from "../lib/audit/index";
import { composeDeployQueue } from "../lib/redis";
import { encryptEnvVars, decryptEnvVars } from "../lib/encryption";
import { hasActiveComposeDeployment } from "../lib/deploy-lock";

import { listComposeServices, ComposeFileError } from "../services/compose";
import { getComposeRunnerForServer, getDockerForServer } from "../services/docker-factory";
import { getTemplate } from "../services/template-catalog";
import { resolveTemplateSpec } from "../services/template-variables";
import { generateStackDomain, DomainUnavailableError } from "../services/stack-domain";

import type { UserRole } from "@deploykit/shared";
import type { db as DbInstanceT } from "../db/index";

import {
  createComposeSchema,
  deployTemplateSchema,
  updateComposeFileSchema,
  updateComposeEnvVarsSchema,
  addComposeDomainSchema,
} from "@deploykit/shared";

type DbT = typeof DbInstanceT;

/**
 * Compose stacks.
 *
 * Every procedure here is a `protectedProcedure`, which only proves the caller
 * is logged in. The real authorization is the project-role check inside each
 * handler — including the read-only ones, because a stack's Compose file and
 * env carry its credentials.
 *
 * Non-members get NOT_FOUND rather than FORBIDDEN so the API does not confirm
 * that a given id exists. FORBIDDEN is reserved for members whose role is too
 * low for the action they asked for.
 */

/** Resolve the caller's role for a stack, or reject as if it did not exist. */
const requireStackRole = async (
  user: Parameters<typeof getProjectRoleByComposeId>[0],
  id: string,
) => {
  const role = await getProjectRoleByComposeId(user, id);
  if (!role)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Compose service not found",
    });
  return role;
};

const requireOperator = (role: UserRole | null) => {
  if (!canOperate(role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Operator access required for this project",
    });
};

/** Reject a Compose file we cannot parse, before it is ever stored. */
const validateComposeFile = (composeFile: string): string[] => {
  try {
    return listComposeServices(composeFile);
  } catch (err: any) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        err instanceof ComposeFileError
          ? err.message
          : "Could not read that Compose file",
    });
  }
};

/** Queue a deployment and return its row, so the UI can follow the logs. */
const queueDeploy = async (
  db: DbT,
  stack: { id: string; name: string },
  mode: "up" | "redeploy",
) => {
  if (await hasActiveComposeDeployment(stack.id)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A deployment of this stack is already in progress",
    });
  }

  const [deployment] = await db
    .insert(deployments)
    .values({ composeServiceId: stack.id, status: "queued" })
    .returning();

  await composeDeployQueue.add("deploy", {
    deploymentId: deployment!.id,
    composeServiceId: stack.id,
    mode,
  });
  return deployment!;
};

export const composeRouter = router({
  /** Stacks in one project, or across every project the caller can see. */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.projectId) {
        const role = await getProjectRole(ctx.user, input.projectId);
        if (!role)
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

        return ctx.db.query.composeServices.findMany({
          where: eq(composeServices.projectId, input.projectId),
          with: { domains: true },
          orderBy: [desc(composeServices.createdAt)],
        });
      }

      // Global admins see everything; everyone else only their memberships.
      if (ctx.user.role === "admin") {
        return ctx.db.query.composeServices.findMany({
          with: { domains: true },
          orderBy: [desc(composeServices.createdAt)],
        });
      }

      const projectIds = await getAccessibleProjectIds(ctx.user);
      if (projectIds.length === 0) return [];

      return ctx.db.query.composeServices.findMany({
        where: inArray(composeServices.projectId, projectIds),
        with: { domains: true },
        orderBy: [desc(composeServices.createdAt)],
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const role = await requireStackRole(ctx.user, input.id);

      const stack = await ctx.db.query.composeServices.findFirst({
        where: eq(composeServices.id, input.id),
        with: { domains: true, server: true },
      });
      if (!stack)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose service not found",
        });

      // The Compose file and the env both carry credentials, so both are gated
      // on the same permission that gates an application's env vars.
      const canSeeSecrets = canViewSecrets(role);
      const { envVars, composeFile, mounts, ...safe } = stack;

      return {
        ...safe,
        composeFile: canSeeSecrets ? composeFile : null,
        mounts: canSeeSecrets ? mounts : null,
        envVars: canSeeSecrets && envVars ? decryptEnvVars(envVars) : {},
        canViewEnv: canSeeSecrets,
        services: listComposeServices(composeFile),
        projectRole: role,
      };
    }),

  /** Containers belonging to this stack, found by the injected service label. */
  containers: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireStackRole(ctx.user, input.id);

      const stack = await ctx.db.query.composeServices.findFirst({
        where: eq(composeServices.id, input.id),
        columns: { id: true, serverId: true },
      });
      if (!stack)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose service not found",
        });

      const { docker } = await getDockerForServer(stack.serverId);
      try {
        return await docker.listServiceContainers(stack.id);
      } catch {
        // A stack that has never deployed has no containers yet.
        return [];
      }
    }),

  /**
   * Recent logs of one container in the stack.
   *
   * Takes the stack id as well as the container id and checks that the
   * container really belongs to that stack: without it, a member of any project
   * could read any container on the host by guessing its id.
   */
  containerLogs: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        containerId: z.string().min(1).max(100),
        tail: z.number().int().min(1).max(5000).default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireStackRole(ctx.user, input.id);

      const stack = await ctx.db.query.composeServices.findFirst({
        where: eq(composeServices.id, input.id),
        columns: { id: true, serverId: true },
      });
      if (!stack)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose service not found",
        });

      const { docker } = await getDockerForServer(stack.serverId);
      try {
        const containers = await docker.listServiceContainers(stack.id);
        if (!containers.some((c) => c.id === input.containerId)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Container not found in this stack",
          });
        }
        return { logs: await docker.getLogs(input.containerId, input.tail) };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        return { logs: "" };
      }
    }),

  deployments: protectedProcedure
    .input(z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      await requireStackRole(ctx.user, input.id);

      return ctx.db.query.deployments.findMany({
        where: eq(deployments.composeServiceId, input.id),
        orderBy: [desc(deployments.createdAt)],
        limit: input.limit,
        columns: {
          id: true,
          status: true,
          errorMessage: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
        },
      });
    }),

  create: protectedProcedure
    .input(createComposeSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.projectId);
      requireOperator(role);

      validateComposeFile(input.composeFile);

      const [stack] = await ctx.db
        .insert(composeServices)
        .values({
          projectId: input.projectId,
          name: input.name,
          sourceType: "raw",
          composeFile: input.composeFile,
          serverId: input.serverId ?? undefined,
        })
        .returning();

      await logAction(ctx, {
        action: "compose.create",
        resourceType: "compose",
        resourceId: stack!.id,
        resourceName: stack!.name,
        metadata: { projectId: stack!.projectId, sourceType: "raw" },
      });
      return stack!;
    }),

  /**
   * Provision a catalogue blueprint: resolve its variables, store the stack,
   * and queue the first deployment.
   *
   * The generated credentials come back once, here, and are never returned in
   * the clear again unless the caller can view secrets.
   */
  deployFromTemplate: protectedProcedure
    .input(deployTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.projectId);
      requireOperator(role);

      const template = await getTemplate(input.templateId);
      if (!template)
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });

      let domain: string;
      try {
        domain =
          input.domain ??
          (await generateStackDomain(input.name, input.serverId));
      } catch (err: any) {
        if (err instanceof DomainUnavailableError) {
          // Only actually needed when the blueprint routes something.
          if (template.spec.domains.length > 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          domain = "";
        } else throw err;
      }

      let resolved;
      try {
        resolved = resolveTemplateSpec(template.spec, { domain });
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Template "${template.spec.id}" is malformed: ${err?.message ?? err}`,
        });
      }

      const services = validateComposeFile(template.compose);
      for (const d of resolved.domains) {
        if (!services.includes(d.service)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Template routes to service "${d.service}", which its Compose file does not define`,
          });
        }
      }

      const [stack] = await ctx.db
        .insert(composeServices)
        .values({
          projectId: input.projectId,
          name: input.name,
          sourceType: "template",
          templateId: template.spec.id,
          templateVersion: template.spec.version,
          composeFile: template.compose,
          envVars: encryptEnvVars(resolved.env),
          mounts: resolved.mounts.length > 0 ? resolved.mounts : undefined,
          serverId: input.serverId ?? undefined,
        })
        .returning();

      if (resolved.domains.length > 0) {
        await ctx.db.insert(composeDomains).values(
          resolved.domains.map((d) => ({
            composeServiceId: stack!.id,
            serviceName: d.service,
            domain: d.host,
            port: d.port,
            path: d.path ?? null,
            // sslip.io hosts cannot get a certificate (Let's Encrypt does not
            // issue for it), so those stay on plain HTTP.
            https: !d.host.endsWith(".sslip.io"),
          })),
        );
      }

      await logAction(ctx, {
        action: "compose.create",
        resourceType: "compose",
        resourceId: stack!.id,
        resourceName: stack!.name,
        metadata: {
          projectId: stack!.projectId,
          sourceType: "template",
          templateId: template.spec.id,
        },
      });

      const deployment = await queueDeploy(ctx.db, stack!, "up");

      return {
        composeServiceId: stack!.id,
        projectId: stack!.projectId,
        name: stack!.name,
        deploymentId: deployment.id,
        domains: resolved.domains.map((d) => ({
          host: d.host,
          https: !d.host.endsWith(".sslip.io"),
        })),
        // Shown once by the UI — after this they only exist encrypted.
        secrets: resolved.secrets,
      };
    }),

  updateComposeFile: protectedProcedure
    .input(updateComposeFileSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await requireStackRole(ctx.user, input.id);
      requireOperator(role);

      validateComposeFile(input.composeFile);

      const [stack] = await ctx.db
        .update(composeServices)
        .set({ composeFile: input.composeFile, updatedAt: new Date() })
        .where(eq(composeServices.id, input.id))
        .returning();

      await logAction(ctx, {
        action: "compose.update",
        resourceType: "compose",
        resourceId: stack!.id,
        resourceName: stack!.name,
      });
      return { success: true };
    }),

  updateEnvVars: protectedProcedure
    .input(updateComposeEnvVarsSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await requireStackRole(ctx.user, input.id);
      requireOperator(role);

      const [stack] = await ctx.db
        .update(composeServices)
        .set({ envVars: encryptEnvVars(input.envVars), updatedAt: new Date() })
        .where(eq(composeServices.id, input.id))
        .returning();

      await logAction(ctx, {
        action: "compose.update_env",
        resourceType: "compose",
        resourceId: stack!.id,
        resourceName: stack!.name,
        metadata: { keys: Object.keys(input.envVars) },
      });
      return { success: true };
    }),

  addDomain: protectedProcedure
    .input(addComposeDomainSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await requireStackRole(ctx.user, input.id);
      requireOperator(role);

      const stack = await ctx.db.query.composeServices.findFirst({
        where: eq(composeServices.id, input.id),
      });
      if (!stack)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose service not found",
        });

      // A typo here would produce Traefik labels attached to nothing and a
      // stack that silently isn't reachable, so reject it now.
      const services = validateComposeFile(stack.composeFile);
      if (!services.includes(input.serviceName)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This stack has no service named "${input.serviceName}". Available: ${services.join(", ")}`,
        });
      }

      const [domain] = await ctx.db
        .insert(composeDomains)
        .values({
          composeServiceId: input.id,
          serviceName: input.serviceName,
          domain: input.domain,
          port: input.port,
          path: input.path ?? null,
          https: input.https,
        })
        .returning();

      await logAction(ctx, {
        action: "compose.add_domain",
        resourceType: "compose",
        resourceId: stack.id,
        resourceName: stack.name,
        metadata: { domain: input.domain, serviceName: input.serviceName },
      });
      return domain!;
    }),

  removeDomain: protectedProcedure
    .input(z.object({ domainId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const domain = await ctx.db.query.composeDomains.findFirst({
        where: eq(composeDomains.id, input.domainId),
      });
      if (!domain)
        throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" });

      const role = await requireStackRole(ctx.user, domain.composeServiceId);
      requireOperator(role);

      await ctx.db
        .delete(composeDomains)
        .where(eq(composeDomains.id, input.domainId));

      await logAction(ctx, {
        action: "compose.remove_domain",
        resourceType: "compose",
        resourceId: domain.composeServiceId,
        metadata: { domain: domain.domain },
      });
      return { success: true };
    }),

  deploy: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        mode: z.enum(["up", "redeploy"]).default("up"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = await requireStackRole(ctx.user, input.id);
      requireOperator(role);

      const stack = await ctx.db.query.composeServices.findFirst({
        where: eq(composeServices.id, input.id),
        columns: { id: true, name: true },
      });
      if (!stack)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose service not found",
        });

      const deployment = await queueDeploy(ctx.db, stack, input.mode);

      await logAction(ctx, {
        action: "compose.deploy",
        resourceType: "compose",
        resourceId: stack.id,
        resourceName: stack.name,
        metadata: { mode: input.mode },
      });
      return { deploymentId: deployment.id };
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      runLifecycle(ctx, input.id, "stop", "stopped"),
    ),

  start: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      runLifecycle(ctx, input.id, "start", "running"),
    ),

  restart: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      runLifecycle(ctx, input.id, "restart", "running"),
    ),

  /**
   * Tear the stack down and forget it.
   *
   * Project-admin only, matching `application.delete` — and here it also
   * destroys the stack's named volumes, so it is genuinely unrecoverable.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const role = await requireStackRole(ctx.user, input.id);
      if (!isAdmin(role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required for this project",
        });

      const stack = await ctx.db.query.composeServices.findFirst({
        where: eq(composeServices.id, input.id),
      });
      if (!stack)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose service not found",
        });

      try {
        const { runner } = await getComposeRunnerForServer(stack.serverId);
        await runner.down({
          stackId: stack.id,
          stackName: stack.name,
          removeVolumes: true,
        });
        await runner.removeStack(stack.id);
      } catch (err: any) {
        // The stack may never have deployed, or the server may be gone. Losing
        // the database row over that would strand the containers instead.
        console.warn(
          `[compose] Teardown of "${stack.name}" reported: ${err?.message ?? err}`,
        );
      }

      await ctx.db
        .delete(composeServices)
        .where(eq(composeServices.id, input.id));

      await logAction(ctx, {
        action: "compose.delete",
        resourceType: "compose",
        resourceId: stack.id,
        resourceName: stack.name,
      });
      return { success: true };
    }),
});

/** Shared body of stop/start/restart: same checks, same status bookkeeping. */
const runLifecycle = async (
  ctx: { user: any; db: any },
  id: string,
  action: "stop" | "start" | "restart",
  nextStatus: string,
) => {
  const role = await requireStackRole(ctx.user, id);
  requireOperator(role);

  const stack = await ctx.db.query.composeServices.findFirst({
    where: eq(composeServices.id, id),
    columns: { id: true, name: true, serverId: true, projectId: true },
  });
  if (!stack)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Compose service not found",
    });

  const { runner } = await getComposeRunnerForServer(stack.serverId);
  try {
    await runner[action]({ stackId: stack.id, stackName: stack.name });
  } catch (err: any) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: err?.message ?? `Could not ${action} the stack`,
    });
  }

  await ctx.db
    .update(composeServices)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(composeServices.id, id));

  await logAction(ctx as never, {
    action: `compose.${action}` as never,
    resourceType: "compose",
    resourceId: stack.id,
    resourceName: stack.name,
  });
  return { success: true };
};
