import { z } from "zod";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { users } from "../db/schema/index";

import { router, publicProcedure, protectedProcedure } from "../trpc";
import { logAction } from "../lib/audit";
import { refreshTokenStore } from "../lib/redis";

export const authRouter = router({
  hasUsers: publicProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.select().from(users).limit(1);
    return result.length > 0;
  }),

  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingUsers = await ctx.db.select().from(users).limit(1);
      const isFirstUser = existingUsers.length === 0;

      if (!isFirstUser) {
        throw new Error(
          "Registration disabled. Ask an admin to create your account.",
        );
      }

      const existing = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      if (existing) throw new Error("Email already in use");

      const hashedPassword = await bcrypt.hash(input.password, 13);
      const [user] = await ctx.db
        .insert(users)
        .values({ email: input.email, password: hashedPassword, role: "admin" })
        .returning();

      const tokens = generateTokens(user!.id);
      await refreshTokenStore.set(tokens.refreshToken, user!.id);
      await logAction({ db: ctx.db, user: user!, ip: ctx.ip }, { action: "auth.register" });
      return { user: sanitizeUser(user!), ...tokens };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      if (!user) throw new Error("Invalid credentials");

      const valid = await bcrypt.compare(input.password, user.password);
      if (!valid) throw new Error("Invalid credentials");

      const tokens = generateTokens(user.id);
      await refreshTokenStore.set(tokens.refreshToken, user.id);
      await logAction({ db: ctx.db, user, ip: ctx.ip }, { action: "auth.login" });
      return { user: sanitizeUser(user), ...tokens };
    }),

  me: protectedProcedure.query(({ ctx }) => {
    return sanitizeUser(ctx.user);
  }),

  refresh: publicProcedure
    .input(z.object({ refreshToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      let payload: { userId: string };

      // Step 1: verify signature
      try {
        payload = jwt.verify(
          input.refreshToken,
          process.env.JWT_REFRESH_SECRET!,
          { algorithms: ["HS256"] },
        ) as { userId: string };
      } catch {
        throw new Error("Invalid refresh token");
      }

      // Step 2: validate against Redis whitelist
      const storedUserId = await refreshTokenStore.get(input.refreshToken);
      if (!storedUserId || storedUserId !== payload.userId) {
        throw new Error("Refresh token revoked or not found");
      }

      // Step 3: load user
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, payload.userId),
      });
      if (!user) throw new Error("User not found");

      // Step 4: rotate — revoke old, issue new
      await refreshTokenStore.del(input.refreshToken);
      const tokens = generateTokens(user.id);
      await refreshTokenStore.set(tokens.refreshToken, user.id);

      return { user: sanitizeUser(user), ...tokens };
    }),

  // Revokes the refresh token server-side so it can't be replayed
  logout: protectedProcedure
    .input(z.object({ refreshToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await refreshTokenStore.del(input.refreshToken);
      await logAction(ctx, { action: "auth.logout" });
      return { success: true };
    }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
      if (!user) throw new Error("User not found");

      const valid = await bcrypt.compare(input.currentPassword, user.password);
      if (!valid) throw new Error("Current password is incorrect");

      const hashedPassword = await bcrypt.hash(input.newPassword, 13);
      await ctx.db
        .update(users)
        .set({ password: hashedPassword, updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id));

      await logAction(ctx, { action: "auth.change_password" });
      return { success: true };
    }),

  updateProfile: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      if (existing && existing.id !== ctx.user.id) {
        throw new Error("Email already in use");
      }

      const [user] = await ctx.db
        .update(users)
        .set({ email: input.email, updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id))
        .returning();
      await logAction(ctx, {
        action: "auth.update_profile",
        metadata: { newEmail: input.email },
      });
      return sanitizeUser(user!);
    }),
});

const generateTokens = (userId: string) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: "15m",
    algorithm: "HS256",
  });
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
  return { accessToken, refreshToken };
};

const sanitizeUser = (user: typeof users.$inferSelect) => {
  const { password, ...rest } = user;
  return rest;
};
