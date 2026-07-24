import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";

import { applications, deployments, domains } from "../db/schema/index";

import { getDockerForServer } from "../services/docker-factory";
import { DockerService } from "../services/docker";
import { router, protectedProcedure } from "../trpc";

import { deployQueue } from "../lib/redis";
import { encrypt, encryptEnvVars, decryptEnvVars } from "../lib/encryption";
import { logAction } from "../lib/audit/audit";
import { autoMapImageVolumes } from "../lib/volumes";
import {
  hasActiveDeployment,
  tryAcquireDeployLock,
  releaseDeployLock,
} from "../lib/deploy-lock";
import { emitDeployStatus, emitServiceStatus } from "../lib/socket";
import {
  getProjectRole,
  getProjectRoleByAppId,
  canOperate,
  isAdmin,
  canViewSecrets,
} from "../lib/permissions";

import {
  createApplicationSchema,
  addDomainSchema,
  repositoryUrlSchema,
  SourceType,
  BuildType,
  DOCKERFILE_PATH_REGEX,
  RELATIVE_PATH_REGEX,
  HTTP_PATH_REGEX,
} from "@deploykit/shared";

export const applicationRouter = router({
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
        with: { domains: true, deployments: true },
      });
      if (!app)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });

      const projectRole = await getProjectRole(ctx.user, app.projectId);
      if (!projectRole)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      let envVars: Record<string, string> = {};
      const canViewEnv = canViewSecrets(projectRole);
      if (app.envVars && canViewEnv) {
        envVars = decryptEnvVars(app.envVars);
      }

      // Never ship secret material (even encrypted) to the client
      const { sourceToken: _st, webhookSecret: _ws, ...safeApp } = app;

      return {
        ...safeApp,
        envVars,
        canViewEnv,
        hasSourceToken: !!app.sourceToken,
        hasWebhookSecret: !!app.webhookSecret,
        projectRole,
      };
    }),

  create: protectedProcedure
    .input(createApplicationSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.projectId);
      if (!canOperate(role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });
      const { sourceToken, volumes, ...rest } = input;
      if (volumes) validateVolumes(volumes);
      const [app] = await ctx.db
        .insert(applications)
        .values({
          ...rest,
          sourceToken: sourceToken ? encrypt(sourceToken) : undefined,
          volumes: volumes && volumes.length > 0 ? volumes : undefined,
        })
        .returning();
      await logAction(ctx, {
        action: "application.create",
        resourceType: "application",
        resourceId: app!.id,
        resourceName: app!.name,
        metadata: {
          projectId: app!.projectId,
          sourceType: app!.sourceType,
          buildType: app!.buildType,
        },
      });
      return app!;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        sourceType: SourceType.optional(),
        repositoryUrl: repositoryUrlSchema.optional(),
        branch: z.string().max(100).optional(),
        buildType: BuildType.optional(),
        dockerfilePath: z
          .string()
          .max(255)
          .regex(DOCKERFILE_PATH_REGEX, "Invalid Dockerfile path")
          .optional(),
        startCommand: z.string().max(500).nullable().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        serverId: z.string().uuid().nullable().optional(),
        sourceToken: z.string().max(500).nullable().optional(),
        webhookSecret: z.string().min(16).max(200).nullable().optional(),
        rootDirectory: z
          .string()
          .max(255)
          .regex(RELATIVE_PATH_REGEX, "Invalid root directory")
          .nullable()
          .optional(),
        volumes: z.array(z.string().max(500)).max(20).nullable().optional(),
        // Resources
        cpuLimit: z.number().int().min(100).max(8000).nullable().optional(),
        memoryLimit: z.number().int().min(64).max(32768).nullable().optional(),
        replicas: z.number().int().min(1).max(10).optional(),
        // Autoscaling
        autoscaleEnabled: z.boolean().optional(),
        autoscaleMin: z.number().int().min(1).max(10).optional(),
        autoscaleMax: z.number().int().min(1).max(10).optional(),
        autoscaleCpuTarget: z.number().int().min(10).max(100).nullable().optional(),
        autoscaleMemTarget: z.number().int().min(10).max(100).nullable().optional(),
        autoscaleCooldown: z.number().int().min(30).max(3600).optional(),
        // Health check
        healthCheckType: z.enum(["http", "tcp", "none"]).optional(),
        healthCheckPath: z
          .string()
          .max(255)
          .regex(HTTP_PATH_REGEX, "Invalid health check path")
          .optional(),
        healthCheckTimeout: z.number().int().min(1).max(60).optional(),
        healthCheckInterval: z.number().int().min(1).max(60).optional(),
        healthCheckRetries: z.number().int().min(1).max(20).optional(),
        healthCheckRequired: z.boolean().optional(),
        // Preview deployments
        previewEnabled: z.boolean().optional(),
        previewDomain: z.string().max(255).nullable().optional(),
        // Public status page visibility
        statusPageVisible: z.boolean().optional(),
        // Image vulnerability scanning (null = inherit global default)
        scanEnabled: z.boolean().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRoleByAppId(ctx.user, input.id);
      if (!canOperate(role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });
      const {
        id,
        sourceToken,
        webhookSecret,
        rootDirectory,
        startCommand,
        volumes,
        ...data
      } = input;
      const [app] = await ctx.db
        .update(applications)
        .set({
          ...data,
          ...(sourceToken !== undefined && {
            sourceToken: sourceToken ? encrypt(sourceToken) : null,
          }),
          ...(webhookSecret !== undefined && {
            webhookSecret: webhookSecret ? encrypt(webhookSecret) : null,
          }),
          ...(rootDirectory !== undefined && {
            rootDirectory: rootDirectory || null,
          }),
          ...(startCommand !== undefined && {
            startCommand: startCommand || null,
          }),
          ...(volumes !== undefined && {
            volumes: (() => {
              if (volumes && volumes.length > 0) {
                validateVolumes(volumes);
                return volumes;
              }
              return null;
            })(),
          }),
          updatedAt: new Date(),
        })
        .where(eq(applications.id, id))
        .returning();
      await logAction(ctx, {
        action: "application.update",
        resourceType: "application",
        resourceId: app!.id,
        resourceName: app!.name,
        metadata: { ...data, hasNewToken: sourceToken !== undefined },
      });
      return app!;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
      });
      if (!app)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      const role = await getProjectRole(ctx.user, app.projectId);
      if (!isAdmin(role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required for this project",
        });
      try {
        const { docker } = await getDockerForServer(app.serverId);
        await docker.removeServiceContainers(app.id);
      } catch {
        // Containers might not exist
      }
      await ctx.db.delete(applications).where(eq(applications.id, input.id));
      await logAction(ctx, {
        action: "application.delete",
        resourceType: "application",
        resourceId: input.id,
        resourceName: app?.name,
      });
      return { success: true };
    }),

  updateEnvVars: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        envVars: z.record(z.string(), z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRoleByAppId(ctx.user, input.id);
      if (!canOperate(role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });
      const encrypted = encryptEnvVars(input.envVars);
      const [app] = await ctx.db
        .update(applications)
        .set({ envVars: encrypted, updatedAt: new Date() })
        .where(eq(applications.id, input.id))
        .returning();
      await logAction(ctx, {
        action: "application.update_env",
        resourceType: "application",
        resourceId: app!.id,
        resourceName: app!.name,
        metadata: { keys: Object.keys(input.envVars) },
      });
      return app!;
    }),

  addDomain: protectedProcedure
    .input(addDomainSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRoleByAppId(ctx.user, input.serviceId);
      if (!canOperate(role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });
      const { serviceId, ...domainData } = input;
      const [domain] = await ctx.db
        .insert(domains)
        .values({ applicationId: serviceId, ...domainData })
        .returning();
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, serviceId),
      });
      await logAction(ctx, {
        action: "application.add_domain",
        resourceType: "application",
        resourceId: serviceId,
        resourceName: app?.name,
        metadata: { domain: domainData.domain, https: domainData.https },
      });
      return domain!;
    }),

  removeDomain: protectedProcedure
    .input(z.object({ domainId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const domain = await ctx.db.query.domains.findFirst({
        where: eq(domains.id, input.domainId),
        with: { application: true },
      });
      if (domain?.applicationId) {
        const role = await getProjectRoleByAppId(
          ctx.user,
          domain.applicationId,
        );
        if (!canOperate(role))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Operator access required for this project",
          });
      }
      await ctx.db.delete(domains).where(eq(domains.id, input.domainId));
      await logAction(ctx, {
        action: "application.remove_domain",
        resourceType: "application",
        resourceId: domain?.applicationId,
        resourceName: domain?.application?.name,
        metadata: { domain: domain?.domain },
      });
      return { success: true };
    }),

  deploy: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
        with: { domains: true },
      });
      if (!app)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });

      const deployRole = await getProjectRole(ctx.user, app.projectId);
      if (!canOperate(deployRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      if (await hasActiveDeployment(app.id))
        throw new TRPCError({
          code: "CONFLICT",
          message: "A deployment is already in progress for this application",
        });

      const [deployment] = await ctx.db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "queued",
        })
        .returning();

      await ctx.db
        .update(applications)
        .set({ status: "building", updatedAt: new Date() })
        .where(eq(applications.id, app.id));

      await deployQueue.add(
        "deploy",
        {
          deploymentId: deployment!.id,
          applicationId: app.id,
        },
        { jobId: deployment!.id },
      );

      await logAction(ctx, {
        action: "application.deploy",
        resourceType: "application",
        resourceId: app.id,
        resourceName: app.name,
        metadata: { deploymentId: deployment!.id, branch: app.branch },
      });

      return deployment!;
    }),

  deployBranch: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        branch: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
      });
      if (!app)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      if (!app.repositoryUrl)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Application has no repository URL configured",
        });

      const branchRole = await getProjectRole(ctx.user, app.projectId);
      if (!canOperate(branchRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      // Validate branch name to prevent injection
      if (!/^[a-zA-Z0-9._\-\/]+$/.test(input.branch)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid branch name",
        });
      }

      if (await hasActiveDeployment(app.id))
        throw new TRPCError({
          code: "CONFLICT",
          message: "A deployment is already in progress for this application",
        });

      const [deployment] = await ctx.db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "queued",
          commitMessage: `Manual deploy from branch: ${input.branch}`,
        })
        .returning();

      await ctx.db
        .update(applications)
        .set({ status: "building", updatedAt: new Date() })
        .where(eq(applications.id, app.id));

      await deployQueue.add(
        "deploy",
        {
          deploymentId: deployment!.id,
          applicationId: app.id,
          branch: input.branch,
        },
        { jobId: deployment!.id },
      );

      await logAction(ctx, {
        action: "application.deploy",
        resourceType: "application",
        resourceId: app.id,
        resourceName: app.name,
        metadata: {
          deploymentId: deployment!.id,
          branch: input.branch,
          manual: true,
        },
      });

      return deployment!;
    }),

  rollback: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        deploymentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Load app with domains (needed for Traefik labels)
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: { domains: true },
      });
      if (!app)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });

      const rollbackRole = await getProjectRole(ctx.user, app.projectId);
      if (!canOperate(rollbackRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      const targetDeployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.deploymentId),
      });
      if (!targetDeployment?.imageName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Target deployment has no image — it may have been cleaned up",
        });
      }

      // Resolve docker service
      const { docker: dockerService, isRemote } = await getDockerForServer(
        app.serverId,
      );

      // Check the image still exists before touching anything
      // Local: use Dockerode inspect. Remote: fall through (SSH will fail clearly).
      if (!isRemote) {
        const localDocker = dockerService as DockerService;
        const exists = await localDocker.imageExistsLocally(
          targetDeployment.imageName,
        );
        if (!exists) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              `Image "${targetDeployment.imageName}" no longer exists on this server. ` +
              `It may have been cleaned up. Re-deploy from source to restore.`,
          });
        }
      }

      // Rollback removes and recreates the same containers a deploy job
      // does, so it must not overlap with one: reject if a deploy is active
      // and hold the per-app lock while working.
      if (await hasActiveDeployment(app.id))
        throw new TRPCError({
          code: "CONFLICT",
          message: "A deployment is already in progress for this application",
        });

      const lockToken = crypto.randomUUID();
      if (!(await tryAcquireDeployLock(app.id, lockToken)))
        throw new TRPCError({
          code: "CONFLICT",
          message: "A deployment is already in progress for this application",
        });

      // Create rollback deployment record
      const [rollbackDeploy] = await ctx.db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "deploying",
          commitHash: targetDeployment.commitHash,
          commitMessage: `Rollback to ${targetDeployment.commitHash || targetDeployment.id.slice(0, 8)}`,
          imageName: targetDeployment.imageName,
          startedAt: new Date(),
        })
        .returning();

      // Update app status so the UI shows it's working
      await ctx.db
        .update(applications)
        .set({ status: "deploying", updatedAt: new Date() })
        .where(eq(applications.id, app.id));

      emitServiceStatus(app.id, "deploying");

      try {
        // Stop current container(s) — remove every replica by label.
        await dockerService.removeServiceContainers(app.id).catch(() => {});

        // Decrypt env vars
        let envList: string[] = [];
        if (app.envVars) {
          const envVars = decryptEnvVars(app.envVars);
          envList = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
        }

        const containerName = `dk-${app.name}`;
        const appVolumes = [...((app.volumes as string[]) ?? [])];

        // Reattach the same deterministic named volumes the deploy worker
        // auto-maps for image-declared `VOLUME` paths, so a rollback keeps
        // that data instead of spawning fresh anonymous volumes.
        try {
          appVolumes.push(
            ...autoMapImageVolumes(
              app.name,
              await dockerService.getImageVolumes(targetDeployment.imageName),
              appVolumes,
            ),
          );
        } catch {
          // Advisory — roll back with the configured volumes only.
        }
        const appDomains = (app.domains ?? []).map((d) => ({
          domain: d.domain,
          https: d.https,
          port: d.port,
        }));

        const baseLabels = {
          "deploykit.managed": "true",
          "deploykit.project": app.projectId,
          "deploykit.service": app.id,
          "deploykit.deployment": rollbackDeploy!.id,
          "deploykit.rollback": "true",
        };

        let containerId: string;

        // Use deployApp when domains exist (Traefik labels)
        const cpuMillicores = app.cpuLimit ?? undefined;
        const memoryMb = app.memoryLimit ?? undefined;

        if (appDomains.length > 0) {
          containerId = await dockerService.deployApp({
            name: containerName,
            image: targetDeployment.imageName,
            env: envList,
            port: app.port ?? 3000,
            domains: appDomains,
            volumes: appVolumes.length > 0 ? appVolumes : undefined,
            labels: baseLabels,
            skipPull: true, // image is already local
            replicas: Math.max(1, app.replicas ?? 1),
            cpuMillicores,
            memoryMb,
          } as any);
        } else {
          containerId = await dockerService.createAndStart({
            name: containerName,
            image: targetDeployment.imageName,
            env: envList,
            networkName: "deploykit-network",
            ports: app.port ? [{ host: app.port, container: app.port }] : [],
            volumes: appVolumes.length > 0 ? appVolumes : undefined,
            labels: baseLabels,
            skipPull: true,
            cpuMillicores,
            memoryMb,
          } as any);
        }

        // Persist success
        await ctx.db
          .update(applications)
          .set({
            containerId,
            containerImage: targetDeployment.imageName,
            status: "running",
            updatedAt: new Date(),
          })
          .where(eq(applications.id, app.id));

        await ctx.db
          .update(deployments)
          .set({ status: "success", finishedAt: new Date() })
          .where(eq(deployments.id, rollbackDeploy!.id));

        emitDeployStatus(rollbackDeploy!.id, "success", {
          applicationId: app.id,
          containerId,
          rollback: true,
        });
        emitServiceStatus(app.id, "running");

        await logAction(ctx, {
          action: "application.deploy",
          resourceType: "application",
          resourceId: app.id,
          resourceName: app.name,
          metadata: {
            rollback: true,
            targetDeploymentId: input.deploymentId,
            image: targetDeployment.imageName,
            domainsRestored: appDomains.length,
          },
        });

        return rollbackDeploy!;
      } catch (error: any) {
        // Mark both the rollback deployment and the app as failed
        await ctx.db
          .update(deployments)
          .set({
            status: "failed",
            errorMessage: error.message,
            finishedAt: new Date(),
          })
          .where(eq(deployments.id, rollbackDeploy!.id));

        await ctx.db
          .update(applications)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(applications.id, app.id));

        emitDeployStatus(rollbackDeploy!.id, "failed", {
          applicationId: app.id,
          error: error.message,
        });
        emitServiceStatus(app.id, "error");

        throw error;
      } finally {
        await releaseDeployLock(app.id, lockToken);
      }
    }),

  start: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
      });
      if (!app?.containerId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No container to start",
        });
      const startRole = await getProjectRole(ctx.user, app.projectId);
      if (!canOperate(startRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });
      const { docker } = await getDockerForServer(app.serverId);
      await docker.startServiceContainers(app.id);
      await ctx.db
        .update(applications)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(applications.id, input.id));
      await logAction(ctx, {
        action: "application.restart",
        resourceType: "application",
        resourceId: app.id,
        resourceName: app.name,
      });
      return { success: true };
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
      });
      if (!app?.containerId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No container to stop",
        });
      const stopRole = await getProjectRole(ctx.user, app.projectId);
      if (!canOperate(stopRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });
      const { docker } = await getDockerForServer(app.serverId);
      await docker.stopServiceContainers(app.id);
      await ctx.db
        .update(applications)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(applications.id, input.id));
      await logAction(ctx, {
        action: "application.stop",
        resourceType: "application",
        resourceId: app.id,
        resourceName: app.name,
      });
      return { success: true };
    }),

  logs: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        tail: z.number().int().min(1).max(5000).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
      });
      // Authorization: only project members may read container logs.
      const role = app
        ? await getProjectRole(ctx.user, app.projectId)
        : null;
      if (!app || !role)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      if (!app.containerId) return { logs: "" };
      try {
        const { docker } = await getDockerForServer(app.serverId);
        const logs = await docker.getLogs(app.containerId, input.tail);
        return { logs };
      } catch {
        return { logs: "" };
      }
    }),

  stats: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
      });
      // Authorization: only project members may read live stats.
      const role = app
        ? await getProjectRole(ctx.user, app.projectId)
        : null;
      if (!app || !role)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      if (!app.containerId) return null;
      try {
        const { docker } = await getDockerForServer(app.serverId);
        return await docker.getStats(app.containerId);
      } catch {
        return null;
      }
    }),

  /** Running instances (replicas) of an app, for the status display. */
  instances: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
      });
      // Authorization: only project members may list running instances.
      const role = app
        ? await getProjectRole(ctx.user, app.projectId)
        : null;
      if (!app || !role)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      try {
        const { docker } = await getDockerForServer(app.serverId);
        return await docker.listServiceContainers(app.id);
      } catch {
        return [];
      }
    }),

  deployments: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Authorization: deployment history exposes build/deploy logs and scan
      // results, so it's restricted to project members.
      const role = await getProjectRoleByAppId(ctx.user, input.id);
      if (!role)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      return ctx.db.query.deployments.findMany({
        where: eq(deployments.applicationId, input.id),
        orderBy: (d, { desc }) => [desc(d.createdAt)],
        limit: 20,
      });
    }),

  listPreviews: protectedProcedure
    .input(z.object({ parentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Authorization: only members of the parent app's project may list previews.
      const role = await getProjectRoleByAppId(ctx.user, input.parentId);
      if (!role)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      return ctx.db.query.applications.findMany({
        where: and(
          eq(applications.parentApplicationId, input.parentId),
          eq(applications.isPreview, true),
        ),
        with: {
          domains: true,
          deployments: {
            orderBy: (d, { desc }) => [desc(d.createdAt)],
            limit: 1,
          },
        },
        orderBy: (a, { desc }) => [desc(a.createdAt)],
      });
    }),

  deletePreview: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: and(
          eq(applications.id, input.id),
          eq(applications.isPreview, true),
        ),
      });
      if (!app)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Preview not found",
        });

      const previewRole = await getProjectRole(ctx.user, app.projectId);
      if (!canOperate(previewRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      if (app.containerId) {
        try {
          const { docker } = await getDockerForServer(app.serverId);
          await docker.stopAndRemove(app.containerId);
        } catch {
          // Container may already be gone
        }
      }

      await ctx.db.delete(applications).where(eq(applications.id, input.id));

      await logAction(ctx, {
        action: "application.delete",
        resourceType: "application",
        resourceId: input.id,
        resourceName: app.name,
        metadata: { preview: true, prNumber: app.previewPrNumber },
      });

      return { success: true };
    }),
});

// Dangerous host paths that must never be mounted.
const FORBIDDEN_PATHS = [
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/boot",
  "/root",
  "/var/run/docker.sock",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
];

// Docker named-volume name: starts alphanumeric, then [a-zA-Z0-9_.-].
const NAMED_VOLUME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/**
 * Validate volume mount strings.
 * Format: <source>:/container/path[:ro] where <source> is either an absolute
 * host path (bind mount) or a Docker named volume (e.g. "dk-app-data").
 * Bind mounts are blocked from sensitive host directories; the container path
 * must always be absolute and free of traversal.
 */
const validateVolumes = (volumes: string[]): void => {
  for (const vol of volumes) {
    const parts = vol.split(":");
    if (parts.length < 2 || parts.length > 3) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid volume format: "${vol}". Use /host/path:/container/path or volume-name:/container/path`,
      });
    }

    const source = parts[0]!;
    const containerPath = parts[1]!;

    // Container path must always be absolute with no traversal
    if (!containerPath.startsWith("/") || containerPath.includes("..")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Container path must be absolute and free of '..': "${vol}"`,
      });
    }

    if (source.startsWith("/")) {
      // Bind mount — block traversal and sensitive host paths
      if (source.includes("..")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Volume paths cannot contain '..'",
        });
      }
      const normalizedHost = source.replace(/\/+$/g, "");
      for (const forbidden of FORBIDDEN_PATHS) {
        if (
          normalizedHost === forbidden ||
          normalizedHost.startsWith(forbidden + "/")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot mount "${forbidden}" — sensitive system path`,
          });
        }
      }
    } else if (!NAMED_VOLUME_REGEX.test(source)) {
      // Named Docker volume — must be a valid volume name
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid volume source: "${source}". Use an absolute host path or a Docker volume name`,
      });
    }
  }
};
