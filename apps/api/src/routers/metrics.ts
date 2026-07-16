import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, asc, and, gte, isNull } from "drizzle-orm";

import {
  router,
  protectedProcedure,
  operatorProcedure,
  adminProcedure,
} from "../trpc";

import { getHistory } from "../services/metrics";

import { alertRules, alertEvents, metricSamples } from "../db/schema/index";

import { canViewService } from "../lib/socket-auth";

// Shared validators
const metricEnum = z.enum(["cpu", "memory", "net_rx", "net_tx"]);
const operatorEnum = z.enum(["gt", "lt"]);
const channelEnum = z.enum(["ui", "slack", "webhook"]);
const serviceTypeEnum = z.enum(["application", "database"]);
const rangeEnum = z.enum(["1h", "6h", "24h", "7d", "30d"]);

const HOUR = 60 * 60 * 1000;
const RANGE_MS: Record<z.infer<typeof rangeEnum>, number> = {
  "1h": HOUR,
  "6h": 6 * HOUR,
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
  "30d": 30 * 24 * HOUR,
};

export const metricsRouter = router({
  history: protectedProcedure
    .input(z.object({ serviceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!(await canViewService(ctx.user, input.serviceId))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      return getHistory(input.serviceId);
    }),

  // Long-term downsampled history for trend charts. Ranges up to 24h use the
  // 1-minute resolution; longer ranges use the 1-hour rollup.
  timeseries: protectedProcedure
    .input(
      z.object({
        serviceId: z.string().uuid(),
        range: rangeEnum.default("24h"),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!(await canViewService(ctx.user, input.serviceId))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      const rangeMs = RANGE_MS[input.range];
      const resolution = rangeMs <= RANGE_MS["24h"] ? "1m" : "1h";
      const since = new Date(Date.now() - rangeMs);

      const rows = await ctx.db.query.metricSamples.findMany({
        where: and(
          eq(metricSamples.serviceId, input.serviceId),
          eq(metricSamples.resolution, resolution),
          gte(metricSamples.bucket, since),
        ),
        orderBy: [asc(metricSamples.bucket)],
      });

      const points = rows.map((r) => ({
        ts: r.bucket.getTime(),
        cpu: r.cpuAvg,
        cpuMax: r.cpuMax,
        mem: r.memAvg,
        memMax: r.memMax,
        memUsed: r.memUsed,
        netRx: r.netRx,
        netTx: r.netTx,
      }));

      // Stitch the live Redis ring onto the tail so the chart stays current
      // (the most recent minute isn't persisted until the rollup runs).
      if (resolution === "1m") {
        const lastTs = points.length ? points[points.length - 1]!.ts : 0;
        const live = await getHistory(input.serviceId);
        for (const s of live) {
          if (s.ts > lastTs) {
            points.push({
              ts: s.ts,
              cpu: s.cpu,
              cpuMax: s.cpu,
              mem: s.memPercent,
              memMax: s.memPercent,
              memUsed: s.memUsed,
              netRx: s.netRx,
              netTx: s.netTx,
            });
          }
        }
      }

      return { resolution, range: input.range, points };
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
