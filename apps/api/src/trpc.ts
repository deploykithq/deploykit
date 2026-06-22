import { initTRPC, TRPCError } from "@trpc/server";
import jwt from "jsonwebtoken";
import type { FastifyRequest } from "fastify";
import { db } from "./db/index";
import type { User } from "./db/schema/index";

export interface Context {
  db: typeof db;
  user: User | null;
  ip: string;
}

const createContext = async (req: FastifyRequest): Promise<Context> => {
  let user: User | null = null;

  // Trust X-Forwarded-For only behind a configured proxy; otherwise it's
  // client-spoofable and would poison audit logs / rate-limit keys.
  const ip =
    (process.env.TRUST_PROXY === "true"
      ? (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      : undefined) ||
    req.ip ||
    "unknown";

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const payload = jwt.verify(token, process.env.JWT_SECRET!, {
        algorithms: ["HS256"],
      }) as { userId: string };
      const result = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, payload.userId),
      });
      user = result ?? null;
    } catch {
      // Invalid token - continue as unauthenticated
    }
  }

  return { db, user, ip };
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
