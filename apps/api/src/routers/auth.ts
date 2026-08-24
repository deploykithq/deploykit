import { randomUUID } from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { router, publicProcedure, protectedProcedure } from "../trpc";

import { users } from "../db/schema/index";

import { logAction } from "../lib/audit/audit";
import { refreshTokenStore, ACCESS_TOKEN_TTL_SEC } from "../lib/redis";
import {
  hashToken,
  createSession,
  rotateSession,
  revokeSessionByToken,
} from "../lib/sessions";

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

      const sessionId = randomUUID();
      const tokens = generateTokens(user!.id, sessionId);
      await createSession({
        db: ctx.db,
        sessionId,
        userId: user!.id,
        token: tokens.refreshToken,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      await logAction(
        { db: ctx.db, user: user!, ip: ctx.ip },
        { action: "auth.register" },
      );
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

      const sessionId = randomUUID();
      const tokens = generateTokens(user.id, sessionId);
      await createSession({
        db: ctx.db,
        sessionId,
        userId: user.id,
        token: tokens.refreshToken,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      await logAction(
        { db: ctx.db, user, ip: ctx.ip },
        { action: "auth.login" },
      );
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

      // Step 2: validate against Redis whitelist (keyed by token hash)
      const storedUserId = await refreshTokenStore.get(
        hashToken(input.refreshToken),
      );
      if (!storedUserId || storedUserId !== payload.userId) {
        throw new Error("Refresh token revoked or not found");
      }

      // Step 3: load user
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, payload.userId),
      });
      if (!user) throw new Error("User not found");

      // Step 4: rotate — move the session onto a fresh token. The session row
      // is authoritative, so a revoked (or unknown) session is rejected here
      // even if its Redis key somehow outlived the revoke.
      const refreshToken = generateRefreshToken(user.id);
      const rotated = await rotateSession({
        db: ctx.db,
        oldToken: input.refreshToken,
        newToken: refreshToken,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      if (!rotated) {
        await refreshTokenStore.del(hashToken(input.refreshToken));
        throw new Error("Refresh token revoked or not found");
      }

      // The session keeps its id across rotations, so the new access token
      // stays bound to the same row an admin can revoke.
      const accessToken = generateAccessToken(user.id, rotated.id);

      return { user: sanitizeUser(user), accessToken, refreshToken };
    }),

  // Revokes the refresh token server-side so it can't be replayed
  logout: protectedProcedure
    .input(z.object({ refreshToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await revokeSessionByToken(ctx.db, input.refreshToken);
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

/**
 * The `sid` claim binds an access token to its session row. Without it a
 * revoked session would keep working until the token expired, since access
 * tokens are never looked up server-side.
 */
const generateAccessToken = (userId: string, sessionId: string) =>
  jwt.sign({ userId, sid: sessionId }, process.env.JWT_SECRET!, {
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    algorithm: "HS256",
  });

const generateRefreshToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: "7d",
    algorithm: "HS256",
  });

const generateTokens = (userId: string, sessionId: string) => ({
  accessToken: generateAccessToken(userId, sessionId),
  refreshToken: generateRefreshToken(userId),
});

const sanitizeUser = (user: typeof users.$inferSelect) => {
  const { password, ...rest } = user;
  return rest;
};
