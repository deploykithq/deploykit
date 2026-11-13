import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createApiTokenSchema } from "@deploykit/shared";

import { apiTokens } from "../db/schema/index";

import { router, sessionProcedure } from "../trpc";
import { logAction } from "../lib/audit/audit";
import { generateApiToken } from "../lib/api-tokens";

const MAX_TOKENS_PER_USER = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

// Everything about a token except its hash.
const publicColumns = {
  id: apiTokens.id,
  name: apiTokens.name,
  tokenPrefix: apiTokens.tokenPrefix,
  scope: apiTokens.scope,
  expiresAt: apiTokens.expiresAt,
  lastUsedAt: apiTokens.lastUsedAt,
  createdAt: apiTokens.createdAt,
};

/**
 * A user's own API tokens. Every procedure is `sessionProcedure`: a token can
 * never list, mint or revoke tokens, so a leaked one cannot extend itself.
 * A token acts as its user, so there is no project role to resolve here —
 * every query is scoped to `ctx.user.id`.
 */
export const apiTokenRouter = router({
  list: sessionProcedure.query(({ ctx }) =>
    ctx.db
      .select(publicColumns)
      .from(apiTokens)
      .where(eq(apiTokens.userId, ctx.user.id))
      .orderBy(desc(apiTokens.createdAt)),
  ),

  create: sessionProcedure
    .input(createApiTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ value: count() })
        .from(apiTokens)
        .where(eq(apiTokens.userId, ctx.user.id));
      if ((existing?.value ?? 0) >= MAX_TOKENS_PER_USER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can have at most ${MAX_TOKENS_PER_USER} API tokens. Revoke one first.`,
        });
      }

      const { token, hash, prefix } = generateApiToken();
      const [row] = await ctx.db
        .insert(apiTokens)
        .values({
          userId: ctx.user.id,
          name: input.name,
          tokenHash: hash,
          tokenPrefix: prefix,
          scope: input.scope,
          expiresAt:
            input.expiresInDays === null
              ? null
              : new Date(Date.now() + input.expiresInDays * DAY_MS),
        })
        .returning(publicColumns);

      await logAction(ctx, {
        action: "api_token.create",
        resourceType: "api_token",
        resourceId: row!.id,
        resourceName: row!.name,
        metadata: { scope: row!.scope, expiresAt: row!.expiresAt },
      });

      // The only time the token itself leaves the server.
      return { ...row!, token };
    }),

  revoke: sessionProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(apiTokens)
        .where(and(eq(apiTokens.id, input.id), eq(apiTokens.userId, ctx.user.id)))
        .returning(publicColumns);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "API token not found" });
      }

      await logAction(ctx, {
        action: "api_token.revoke",
        resourceType: "api_token",
        resourceId: row.id,
        resourceName: row.name,
      });
      return { success: true };
    }),
});
