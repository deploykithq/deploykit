import { z } from "zod";
import { desc, and, eq, gte, lte, like, or } from "drizzle-orm";

import { router, adminProcedure } from "../trpc";

import { auditLogs } from "../db/schema/index";

const PAGE_SIZE = 50;

export const auditRouter = router({
  list: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        // Filters
        userId: z.string().uuid().optional(),
        resourceType: z.string().optional(),
        action: z.string().optional(),
        search: z.string().max(100).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input.userId) {
        conditions.push(eq(auditLogs.userId, input.userId));
      }
      if (input.resourceType) {
        conditions.push(eq(auditLogs.resourceType, input.resourceType));
      }
      if (input.action) {
        conditions.push(like(auditLogs.action, `${input.action}%`));
      }
      if (input.search) {
        conditions.push(
          or(
            like(auditLogs.userEmail, `%${input.search}%`),
            like(auditLogs.resourceName, `%${input.search}%`),
            like(auditLogs.action, `%${input.search}%`),
          ),
        );
      }
      if (input.from) {
        conditions.push(gte(auditLogs.createdAt, new Date(input.from)));
      }
      if (input.to) {
        conditions.push(lte(auditLogs.createdAt, new Date(input.to)));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (input.page - 1) * PAGE_SIZE;

      const [rows, countRows] = await Promise.all([
        ctx.db.query.auditLogs.findMany({
          where,
          orderBy: [desc(auditLogs.createdAt)],
          limit: PAGE_SIZE,
          offset,
        }),
        ctx.db.$count(auditLogs, where),
      ]);

      return {
        entries: rows,
        total: Number(countRows),
        page: input.page,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(Number(countRows) / PAGE_SIZE),
      };
    }),

  // Quick stats for the header summary cards
  stats: adminProcedure.query(async ({ ctx }) => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [last24h, last7d, deployments] = await Promise.all([
      ctx.db.$count(auditLogs, gte(auditLogs.createdAt, since24h)),
      ctx.db.$count(auditLogs, gte(auditLogs.createdAt, since7d)),
      ctx.db.$count(
        auditLogs,
        and(
          gte(auditLogs.createdAt, since7d),
          like(auditLogs.action, "application.deploy%"),
        ),
      ),
    ]);

    return {
      last24h: Number(last24h),
      last7d: Number(last7d),
      deployments7d: Number(deployments),
    };
  }),
});
