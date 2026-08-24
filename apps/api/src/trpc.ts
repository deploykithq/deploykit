import jwt from "jsonwebtoken";
import { initTRPC, TRPCError } from "@trpc/server";

import { db } from "./db/index";
import { revokedSessionStore } from "./lib/redis";

import type { UserT } from "./db/schema/index";
import type { FastifyRequest } from "fastify";

export interface Context {
  db: typeof db;
  user: UserT | null;
  ip: string;
  userAgent: string | null;
}

const createContext = async (req: FastifyRequest): Promise<Context> => {
  let user: UserT | null = null;

  // Trust X-Forwarded-For only behind a configured proxy; otherwise it's
  // client-spoofable and would poison audit logs / rate-limit keys.
  const ip =
    (process.env.TRUST_PROXY === "true"
      ? (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      : undefined) ||
    req.ip ||
    "unknown";

  // Recorded on sessions so admins can tell one device from another
  const userAgent =
    (req.headers["user-agent"] as string | undefined)?.slice(0, 512) ?? null;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const payload = jwt.verify(token, process.env.JWT_SECRET!, {
        algorithms: ["HS256"],
      }) as { userId: string; sid?: string };

      // Access tokens are stateless, so a revoked session would otherwise keep
      // working until it expired. Tokens minted before sessions existed carry
      // no sid and simply age out.
      const revoked = payload.sid
        ? await revokedSessionStore.isRevoked(payload.sid)
        : false;

      if (!revoked) {
        const result = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, payload.userId),
        });
        user = result ?? null;
      }
    } catch {
      // Invalid token - continue as unauthenticated
    }
  }

  return { db, user, ip, userAgent };
};

const t = initTRPC.context<Context>().create();

const router = t.router;
const publicProcedure = t.procedure;

const isAuthenticated = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const isAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const isOperatorOrAbove = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  if (ctx.user.role !== "admin" && ctx.user.role !== "operator") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Operator access required",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const adminProcedure = t.procedure.use(isAdmin);
const operatorProcedure = t.procedure.use(isOperatorOrAbove);
const protectedProcedure = t.procedure.use(isAuthenticated);

export {
  createContext,
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  operatorProcedure,
};
