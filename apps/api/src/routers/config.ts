import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { MANIFEST_MAX_LENGTH, SECRETS_MAX_LENGTH } from "@deploykit/shared";

import { adminProcedure, protectedProcedure, router } from "../trpc";
import { logAction } from "../lib/audit/audit";
import { canViewSecrets, getProjectRole } from "../lib/permissions";
import { exportConfig } from "../services/config-export";
import { ManifestParseError, runImport } from "../services/config-import";

/**
 * Export and import of the instance's configuration as YAML.
 *
 * Both exports are **mutations**, not queries: the response can carry every
 * secret in the instance, and a query would park it in the browser's React
 * Query cache for the rest of the session.
 */
export const configRouter = router({
  /**
   * The whole instance. Global admins only — the document spans every project,
   * so there is no per-project role that could authorize it.
   */
  exportInstance: adminProcedure
    .input(z.object({ includeSecrets: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const result = await exportConfig({
        projectIds: null,
        includeSecrets: input.includeSecrets,
      });
      await logAction(ctx, {
        action: "config.export",
        metadata: {
          scope: "instance",
          includeSecrets: input.includeSecrets,
          ...result.counts,
        },
      });
      return result;
    }),

  /**
   * One project. Requires project operator+, not mere membership: even without
   * the secrets document the manifest carries the stack's Compose file and the
   * names of its env vars, which `compose.byId` gates on exactly this
   * predicate.
   */
  exportProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        includeSecrets: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.projectId);
      if (!role)
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      if (!canViewSecrets(role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });

      const result = await exportConfig({
        projectIds: [input.projectId],
        includeSecrets: input.includeSecrets,
      });
      await logAction(ctx, {
        action: "config.export",
        resourceType: "project",
        resourceId: input.projectId,
        metadata: {
          scope: "project",
          includeSecrets: input.includeSecrets,
          ...result.counts,
        },
      });
      return result;
    }),

  /**
   * Plan or apply a manifest. `dryRun` (the default) returns the plan without
   * writing anything; the same call with `dryRun: false` applies it, so the
   * preview an operator confirms cannot diverge from what runs.
   */
  import: adminProcedure
    .input(
      z.object({
        manifest: z.string().min(1).max(MANIFEST_MAX_LENGTH),
        secrets: z.string().max(SECRETS_MAX_LENGTH).optional(),
        dryRun: z.boolean().default(true),
        /**
         * A manifest restored onto a fresh host references servers that do not
         * exist yet. Failing is the default because silently moving a workload
         * onto the controller host is not a decision a text file should make.
         */
        onMissingServer: z.enum(["fail", "local"]).default("fail"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let plan;
      try {
        plan = await runImport({
          manifestText: input.manifest,
          secretsText: input.secrets ?? null,
          dryRun: input.dryRun,
          onMissingServer: input.onMissingServer,
        });
      } catch (err) {
        if (err instanceof ManifestParseError)
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        throw err;
      }

      if (plan.applied)
        await logAction(ctx, {
          action: "config.import",
          metadata: {
            created: plan.counts.create,
            skipped: plan.counts.skip + plan.counts["skip-exists"],
            secretsProvided: plan.secretsProvided,
            missingSecrets: plan.missingSecrets.length,
            warnings: plan.warnings.length,
          },
        });

      return plan;
    }),
});
