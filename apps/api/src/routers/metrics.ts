import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, and, isNull } from "drizzle-orm";

import { alertRules, alertEvents } from "../db/schema/index";
import { getHistory } from "../services/metrics";
import { canViewService } from "../lib/socket-auth";
import {
  router,
  protectedProcedure,
  operatorProcedure,
  adminProcedure,
} from "../trpc";

// Shared validators
const metricEnum = z.enum(["cpu", "memory", "net_rx", "net_tx"]);
const operatorEnum = z.enum(["gt", "lt"]);
const channelEnum = z.enum(["ui", "slack", "webhook"]);
const serviceTypeEnum = z.enum(["application", "database"]);

export const metricsRouter = router({
  // Returns the last ~60 samples (30 min at 30s intervals)
  history: protectedProcedure
    .input(z.object({ serviceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!(await canViewService(ctx.user, input.serviceId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }
      return getHistory(input.serviceId);
    }),

  listRules: protectedProcedure
    .input(
      z
        .object({
          serviceId: z.string().uuid().optional(),
          serviceType: serviceTypeEnum.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.serviceId) {
        return ctx.db.query.alertRules.findMany({
          where: and(
            eq(alertRules.serviceId, input.serviceId),
            input.serviceType
              ? eq(alertRules.serviceType, input.serviceType)
              : undefined,
          ),
          orderBy: [desc(alertRules.createdAt)],
        });
      }
      return ctx.db.query.alertRules.findMany({
        orderBy: [desc(alertRules.createdAt)],
      });
    }),

  createRule: operatorProcedure
    .input(
      z.object({
        serviceType: serviceTypeEnum,
        serviceId: z.string().uuid(),
        serviceName: z.string().max(255).optional(),
        metric: metricEnum,
        operator: operatorEnum,
        threshold: z.number().int().min(0).max(100),
        channel: channelEnum,
        channelConfig: z.record(z.string()).optional(),
        cooldownMinutes: z.number().int().min(1).max(1440).default(15),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [rule] = await ctx.db.insert(alertRules).values(input).returning();
      return rule!;
    }),

  updateRule: operatorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        metric: metricEnum.optional(),
        operator: operatorEnum.optional(),
        threshold: z.number().int().min(0).max(100).optional(),
        channel: channelEnum.optional(),
        channelConfig: z.record(z.string()).optional(),
        cooldownMinutes: z.number().int().min(1).max(1440).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [rule] = await ctx.db
        .update(alertRules)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(alertRules.id, id))
        .returning();
      return rule!;
    }),

  deleteRule: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(alertRules).where(eq(alertRules.id, input.id));
      return { success: true };
    }),

  recentEvents: protectedProcedure
    .input(
      z
        .object({
          serviceId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          onlyOpen: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input?.serviceId) {
        conditions.push(eq(alertEvents.serviceId, input.serviceId));
      }
      if (input?.onlyOpen) {
        conditions.push(isNull(alertEvents.resolvedAt));
      }

      return ctx.db.query.alertEvents.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(alertEvents.createdAt)],
        limit: input?.limit ?? 50,
      });
    }),

  // Stats for the header cards
  alertStats: protectedProcedure.query(async ({ ctx }) => {
    const [open, total, rules] = await Promise.all([
      ctx.db.$count(alertEvents, isNull(alertEvents.resolvedAt)),
      ctx.db.$count(alertEvents),
      ctx.db.$count(alertRules, eq(alertRules.enabled, true)),
    ]);
    return {
      openAlerts: Number(open),
      totalEvents: Number(total),
      activeRules: Number(rules),
    };
  }),
});
