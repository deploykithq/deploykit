import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, ilike, lte } from "drizzle-orm";

import { router, protectedProcedure } from "../trpc";

import { containerLogs } from "../db/schema/index";

import { canViewService } from "../lib/socket-auth";

const PAGE_SIZE = 100;
const levelEnum = z.enum(["error", "warn", "info", "debug", "fatal"]);

export const logsRouter = router({
  // Paginated, filterable search over persisted runtime logs for one service.
  search: protectedProcedure
    .input(
      z.object({
        serviceId: z.string().uuid(),
        query: z.string().max(200).optional(),
        level: levelEnum.optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        page: z.number().int().min(1).default(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!(await canViewService(ctx.user, input.serviceId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Service not found",
        });
      }

      const conditions = [eq(containerLogs.serviceId, input.serviceId)];
      if (input.query) {
        conditions.push(ilike(containerLogs.message, `%${input.query}%`));
      }
      if (input.level) {
        conditions.push(eq(containerLogs.level, input.level));
      }
      if (input.from) {
        conditions.push(gte(containerLogs.timestamp, new Date(input.from)));
      }
      if (input.to) {
        conditions.push(lte(containerLogs.timestamp, new Date(input.to)));
      }

      const where = and(...conditions);
      const offset = (input.page - 1) * PAGE_SIZE;

      const [rows, total] = await Promise.all([
        ctx.db.query.containerLogs.findMany({
          where,
          orderBy: [desc(containerLogs.timestamp)],
          limit: PAGE_SIZE,
          offset,
        }),
        ctx.db.$count(containerLogs, where),
      ]);

      return {
        entries: rows,
        total: Number(total),
        page: input.page,
        pageSize: PAGE_SIZE,
        totalPages: Math.max(1, Math.ceil(Number(total) / PAGE_SIZE)),
      };
    }),
});
