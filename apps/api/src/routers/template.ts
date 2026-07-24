import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "../trpc";
import { volumePathSlug } from "../lib/volumes";

import { applicationRouter } from "./application";
import { databaseRouter } from "./database";

import { TEMPLATES, getTemplateById, deployTemplateSchema } from "@deploykit/shared";

export const templateRouter = router({
  /** Static catalog of one-click templates. */
  list: protectedProcedure.query(() => TEMPLATES),

  /**
   * Provision every resource declared by a template, in order, reusing the
   * existing application/database procedures (so permissions, encryption,
   * Docker provisioning and audit logging all apply unchanged).
   */
  deploy: protectedProcedure
    .input(deployTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const template = getTemplateById(input.templateId);
      if (!template)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });

      // Callers run the full middleware chain of each sub-procedure, so the
      // per-project operator check is enforced for every created resource.
      const appCaller = applicationRouter.createCaller(ctx);
      const dbCaller = databaseRouter.createCaller(ctx);

      const dbByRef = new Map<string, { connectionString: string }>();
      const databases: { id: string; name: string; connectionString: string }[] =
        [];
      const applications: { id: string; name: string; deployed: boolean }[] = [];

      for (const resource of template.resources) {
        const resourceName = `${input.name}${resource.nameSuffix}`;

        if (resource.kind === "database") {
          const created = await dbCaller.create({
            projectId: input.projectId,
            name: resourceName,
            type: resource.type,
            version: resource.version,
            serverId: input.serverId ?? undefined,
            replicaSet: false,
          });
          dbByRef.set(resource.ref, {
            connectionString: created.connectionString,
          });
          databases.push({
            id: created.id,
            name: created.name,
            connectionString: created.connectionString,
          });
          continue;
        }

        // Persist requested container paths as deterministic named volumes,
        // so data survives redeploys (volume name is stable per app + path).
        const volumes = (resource.volumes ?? []).map(
          (containerPath) =>
            `dk-${resourceName}-${volumePathSlug(containerPath)}:${containerPath}`,
        );

        const created = await appCaller.create({
          projectId: input.projectId,
          name: resourceName,
          sourceType: resource.sourceType,
          repositoryUrl: resource.repositoryUrl,
          branch: resource.branch ?? "main",
          buildType: resource.buildType ?? "nixpacks",
          port: resource.port,
          volumes: volumes.length > 0 ? volumes : undefined,
          serverId: input.serverId ?? undefined,
        });

        // Resolve environment variables (static + DB connection string).
        const env: Record<string, string> = { ...(resource.env ?? {}) };
        if (resource.envFromDatabase) {
          const source = dbByRef.get(resource.envFromDatabase.ref);
          if (source?.connectionString) {
            env[resource.envFromDatabase.envKey] =
              source.connectionString + (resource.envFromDatabase.append ?? "");
          }
        }
        if (Object.keys(env).length > 0) {
          await appCaller.updateEnvVars({ id: created.id, envVars: env });
        }

        let deployed = false;
        if (resource.autoDeploy) {
          await appCaller.deploy({ id: created.id });
          deployed = true;
        }
        applications.push({ id: created.id, name: created.name, deployed });
      }

      return {
        templateId: template.id,
        projectId: input.projectId,
        applications,
        databases,
        primaryApplicationId: applications[0]?.id ?? null,
      };
    }),
});
