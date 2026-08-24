import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";

import { router, adminProcedure } from "../trpc";

import { sessions, users } from "../db/schema/index";

import { logAction } from "../lib/audit/audit";
import { revokeSessionById } from "../lib/sessions";

const PAGE_SIZE = 25;

/**
 * Session status is derived, never stored:
 *   active  — not revoked and not past its expiry
 *   expired — everything else, revoked sessions included
 */
const isActive = () =>
  and(isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`));

const isExpired = () =>
  or(sql`${sessions.revokedAt} is not null`, lte(sessions.expiresAt, sql`now()`));

const statusFilter = (status: "all" | "active" | "expired") => {
  if (status === "active") return isActive();
  if (status === "expired") return isExpired();
  return undefined;
};

export const sessionRouter = router({
  list: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        status: z.enum(["all", "active", "expired"]).default("all"),
        userId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      const byStatus = statusFilter(input.status);
      if (byStatus) conditions.push(byStatus);
      if (input.userId) conditions.push(eq(sessions.userId, input.userId));

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (input.page - 1) * PAGE_SIZE;

      // Token material (raw or hashed) is deliberately absent from the selection
      const [rows, total] = await Promise.all([
        ctx.db
          .select({
            id: sessions.id,
            userId: sessions.userId,
            userEmail: users.email,
            userRole: users.role,
            ip: sessions.ip,
            userAgent: sessions.userAgent,
            createdAt: sessions.createdAt,
            lastUsedAt: sessions.lastUsedAt,
            expiresAt: sessions.expiresAt,
            revokedAt: sessions.revokedAt,
          })
          .from(sessions)
          .innerJoin(users, eq(sessions.userId, users.id))
          .where(where)
          .orderBy(desc(sessions.lastUsedAt))
          .limit(PAGE_SIZE)
          .offset(offset),
        ctx.db.$count(sessions, where),
      ]);

      const now = Date.now();
      const entries = rows.map((row) => ({
        ...row,
        status: row.revokedAt
          ? ("revoked" as const)
          : row.expiresAt.getTime() > now
            ? ("active" as const)
            : ("expired" as const),
      }));

      return {
        entries,
        total: Number(total),
        page: input.page,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(Number(total) / PAGE_SIZE),
      };
    }),

  // Summary cards above the table
  stats: adminProcedure.query(async ({ ctx }) => {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [activeSessions, activeUsers, expired7d] = await Promise.all([
      ctx.db.$count(sessions, isActive()),
      ctx.db
        .select({
          count: sql<number>`count(distinct ${sessions.userId})`,
        })
        .from(sessions)
        .where(isActive()),
      ctx.db.$count(
        sessions,
        and(isExpired(), gte(sessions.expiresAt, since7d)),
      ),
    ]);

    return {
      activeSessions: Number(activeSessions),
      activeUsers: Number(activeUsers[0]?.count ?? 0),
      expired7d: Number(expired7d),
    };
  }),

  revoke: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await revokeSessionById(ctx.db, input.id);
      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const owner = await ctx.db.query.users.findFirst({
        where: eq(users.id, session.userId),
      });

      await logAction(ctx, {
        action: "session.revoke",
        resourceType: "session",
        resourceId: session.id,
        resourceName: owner?.email ?? undefined,
        metadata: { userId: session.userId, ip: session.ip },
      });

      return { success: true };
    }),
});
