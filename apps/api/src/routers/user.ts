import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { users } from "../db/schema/index";

import { router, adminProcedure } from "../trpc";
import { logAction } from "../lib/audit";

import { createUserSchema, updateUserRoleSchema } from "@deploykit/shared";

export const userRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.query.users.findMany({
      orderBy: (u, { desc }) => [desc(u.createdAt)],
    });
    return result.map(({ password, ...user }) => user);
  }),

  create: adminProcedure
    .input(createUserSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      if (existing) throw new Error("Email already in use");

      const hashedPassword = await bcrypt.hash(input.password, 13);
      const [user] = await ctx.db
        .insert(users)
        .values({ email: input.email, password: hashedPassword, role: input.role })
        .returning();

      await logAction(ctx, {
        action: "user.create",
        resourceType: "user",
        resourceId: user!.id,
        resourceName: user!.email,
        metadata: { role: user!.role },
      });

      const { password, ...rest } = user!;
      return rest;
    }),

  updateRole: adminProcedure
    .input(updateUserRoleSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new Error("Cannot change your own role");
      }

      const [user] = await ctx.db
        .update(users)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(users.id, input.id))
        .returning();
      if (!user) throw new Error("User not found");

      await logAction(ctx, {
        action: "user.update_role",
        resourceType: "user",
        resourceId: user.id,
        resourceName: user.email,
        metadata: { newRole: input.role },
      });

      const { password, ...rest } = user;
      return rest;
    }),

  resetPassword: adminProcedure
    .input(z.object({ id: z.string().uuid(), newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new Error("Use the Change Password form for your own account");
      }

      const target = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.id),
      });

      const hashedPassword = await bcrypt.hash(input.newPassword, 13);
      const [user] = await ctx.db
        .update(users)
        .set({ password: hashedPassword, updatedAt: new Date() })
        .where(eq(users.id, input.id))
        .returning();
      if (!user) throw new Error("User not found");

      await logAction(ctx, {
        action: "user.reset_password",
        resourceType: "user",
        resourceId: input.id,
        resourceName: target?.email,
      });

      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new Error("Cannot delete your own account");
      }

      const target = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.id),
      });

      await ctx.db.delete(users).where(eq(users.id, input.id));

      await logAction(ctx, {
        action: "user.delete",
        resourceType: "user",
        resourceId: input.id,
        resourceName: target?.email,
      });

      return { success: true };
    }),
});
