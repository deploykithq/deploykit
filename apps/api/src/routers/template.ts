import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure, adminProcedure, operatorProcedure } from "../trpc";

import {
  listTemplates,
  getTemplate,
  refreshCatalog,
  parseTemplate,
  fetchTemplateFromUrl,
  registryUrl,
} from "../services/template-catalog";

/**
 * Read-only access to the blueprint catalogue.
 *
 * The catalogue is public data — it carries no credentials, only instructions
 * for generating them — so any authenticated user may browse it. Turning a
 * blueprint into running containers is `compose.deployFromTemplate`, which is
 * where the project-role check lives.
 */
export const templateRouter = router({
  list: protectedProcedure.query(() => listTemplates()),

  byId: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const template = await getTemplate(input.id);
      if (!template)
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      return template;
    }),

  /** Which registry is in use, and whether it is currently reachable. */
  registry: adminProcedure.query(async () => {
    const { source } = await listTemplates();
    return { url: registryUrl(), source };
  }),

  refreshCatalog: adminProcedure.mutation(() => refreshCatalog()),

  /**
   * Validate a blueprint the user supplied, without deploying it.
   *
   * Operator, not admin: importing is how you deploy something the catalogue
   * does not carry, and creating resources is already an operator action.
   * Nothing is persisted here — the validated blueprint goes straight back to
   * the client, which then posts it to `compose.create`.
   */
  import: operatorProcedure
    .input(
      z.union([
        z.object({
          source: z.literal("inline"),
          spec: z.string().min(1).max(200_000),
          compose: z.string().min(1).max(500_000),
        }),
        z.object({
          source: z.literal("url"),
          url: z.string().url().max(500),
        }),
      ]),
    )
    .mutation(async ({ input }) => {
      try {
        return input.source === "inline"
          ? parseTemplate(input.spec, input.compose)
          : await fetchTemplateFromUrl(input.url);
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err?.message ?? "Could not read that template",
        });
      }
    }),
});
