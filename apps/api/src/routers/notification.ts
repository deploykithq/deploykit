import { z } from "zod";
import { eq, isNull, desc } from "drizzle-orm";

import { TRPCError } from "@trpc/server";

import { router, protectedProcedure, operatorProcedure } from "../trpc";

import { sendTestNotification } from "../services/notifier";

import { notificationChannels, NOTIFICATION_EVENTS } from "../db/schema/index";

import { logAction } from "../lib/audit/audit";
import { isLiterallyPublicUrl } from "../lib/ssrf";
import { getProjectRole, canViewSecrets } from "../lib/permissions";

import type { Context } from "../trpc";

/**
 * Channel configs may hold secrets (bot tokens, webhook URLs), so reading
 * them requires operator+ on the owning project, or global operator/admin
 * for instance-wide channels (projectId = null).
 */
const assertCanManageChannels = async (
  ctx: Context & { user: NonNullable<Context["user"]> },
  projectId: string | null,
): Promise<void> => {
  if (projectId) {
    const role = await getProjectRole(ctx.user, projectId);
    if (!canViewSecrets(role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Operator access required for this project",
      });
    }
    return;
  }
  if (ctx.user.role !== "admin" && ctx.user.role !== "operator") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Operator access required",
    });
  }
};

const channelTypeEnum = z.enum([
  "discord",
  "slack",
  "telegram",
  "email",
  "webhook",
]);

const eventEnum = z.enum(
  NOTIFICATION_EVENTS as unknown as [string, ...string[]],
);

// Config keys that hold an outbound URL — reject obviously-internal targets
// at validation time (a deeper DNS-resolving check runs again before fetch).
const URL_CONFIG_KEYS = ["url", "webhookUrl"] as const;

const channelConfigSchema = z
  .record(z.string(), z.string())
  .superRefine((config, ctx) => {
    for (const key of URL_CONFIG_KEYS) {
      const value = config[key];
      if (value && !isLiterallyPublicUrl(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must be a public http(s) URL`,
          path: [key],
        });
      }
    }
  });

export const notificationRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCanManageChannels(ctx, input.projectId ?? null);
      if (input.projectId) {
        return ctx.db.query.notificationChannels.findMany({
          where: eq(notificationChannels.projectId, input.projectId),
          orderBy: [desc(notificationChannels.createdAt)],
        });
      }
      // Global channels
      return ctx.db.query.notificationChannels.findMany({
        where: isNull(notificationChannels.projectId),
        orderBy: [desc(notificationChannels.createdAt)],
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const channel = await ctx.db.query.notificationChannels.findFirst({
        where: eq(notificationChannels.id, input.id),
      });
      if (!channel) throw new Error("Notification channel not found");
      await assertCanManageChannels(ctx, channel.projectId);
      return channel;
    }),

  create: operatorProcedure
    .input(
      z.object({
        projectId: z.string().uuid().nullable().optional(),
        name: z.string().min(1).max(100),
        type: channelTypeEnum,
        config: channelConfigSchema,
        events: z.array(eventEnum).min(1),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageChannels(ctx, input.projectId ?? null);
      const [channel] = await ctx.db
        .insert(notificationChannels)
        .values({
          projectId: input.projectId || null,
          name: input.name,
          type: input.type,
          config: input.config,
          events: input.events,
          enabled: input.enabled,
        })
        .returning();

      await logAction(ctx, {
        action: "notification.create",
        resourceType: "notification_channel",
        resourceId: channel!.id,
        resourceName: channel!.name,
        metadata: { type: input.type, events: input.events },
      });

      return channel!;
    }),

  update: operatorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        config: channelConfigSchema.optional(),
        events: z.array(eventEnum).min(1).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const existing = await ctx.db.query.notificationChannels.findFirst({
        where: eq(notificationChannels.id, id),
      });
      if (!existing) throw new Error("Notification channel not found");
      await assertCanManageChannels(ctx, existing.projectId);
      const [channel] = await ctx.db
        .update(notificationChannels)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationChannels.id, id))
        .returning();

      await logAction(ctx, {
        action: "notification.update",
        resourceType: "notification_channel",
        resourceId: channel!.id,
        resourceName: channel!.name,
      });

      return channel!;
    }),

  delete: operatorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await ctx.db.query.notificationChannels.findFirst({
        where: eq(notificationChannels.id, input.id),
      });
      if (channel) await assertCanManageChannels(ctx, channel.projectId);

      await ctx.db
        .delete(notificationChannels)
        .where(eq(notificationChannels.id, input.id));

      await logAction(ctx, {
        action: "notification.delete",
        resourceType: "notification_channel",
        resourceId: input.id,
        resourceName: channel?.name,
      });

      return { success: true };
    }),

  toggle: operatorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await ctx.db.query.notificationChannels.findFirst({
        where: eq(notificationChannels.id, input.id),
      });
      if (!channel) throw new Error("Channel not found");
      await assertCanManageChannels(ctx, channel.projectId);

      const [updated] = await ctx.db
        .update(notificationChannels)
        .set({ enabled: !channel.enabled, updatedAt: new Date() })
        .where(eq(notificationChannels.id, input.id))
        .returning();

      return updated!;
    }),

  test: operatorProcedure
    .input(
      z.object({
        type: channelTypeEnum,
        config: channelConfigSchema,
      }),
    )
    .mutation(async ({ input }) => {
      return sendTestNotification(input.type, input.config);
    }),

  availableEvents: protectedProcedure.query(() => {
    return NOTIFICATION_EVENTS.map((event) => ({
      value: event,
      label: event
        .replace(/\./g, " → ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    }));
  }),
});
