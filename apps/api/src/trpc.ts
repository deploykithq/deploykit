import jwt from "jsonwebtoken";
import { initTRPC, TRPCError } from "@trpc/server";

import { db } from "./db/index";
import { isApiToken, resolveApiToken, tokenAllowsCall } from "./lib/api-tokens";

import type { UserT } from "./db/schema/index";
import type { ApiTokenContextT } from "./lib/api-tokens";
import type { FastifyRequest } from "fastify";

export interface Context {
  db: typeof db;
  user: UserT | null;
  ip: string;
  /** Set when the request authenticated with an API token instead of a session. */
  apiToken: ApiTokenContextT | null;
}

const createContext = async (req: FastifyRequest): Promise<Context> => {
  let user: UserT | null = null;
  let apiToken: ApiTokenContextT | null = null;

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
      if (isApiToken(token)) {
        // An API token acts as its user: the role still comes from the DB.
        const resolved = await resolveApiToken(db, token);
        if (resolved) {
          user = resolved.user;
          apiToken = resolved.apiToken;
        }
      } else {
        const payload = jwt.verify(token, process.env.JWT_SECRET!, {
          algorithms: ["HS256"],
        }) as { userId: string };
        const result = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, payload.userId),
        });
        user = result ?? null;
      }
    } catch {
      // Invalid token - continue as unauthenticated
    }
  }

  return { db, user, ip, apiToken };
};

const t = initTRPC.context<Context>().create();

const router = t.router;
const publicProcedure = t.procedure;

/**
 * A `read` API token may only call queries. Checked by every authenticated
 * procedure builder, so no router has to remember it.
 */
const assertTokenAllowsCall = (
  ctx: Context,
  type: "query" | "mutation" | "subscription",
) => {
  if (!tokenAllowsCall(ctx.apiToken, type)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This API token is read-only",
    });
  }
};

const isAuthenticated = t.middleware(({ ctx, type, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  assertTokenAllowsCall(ctx, type);
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Account management (password, email, API tokens, users) needs a real
 * session: a leaked token must not be able to mint more tokens or lock its
 * owner out.
 */
const isSession = t.middleware(({ ctx, next }) => {
  if (ctx.apiToken) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action is not available to API tokens",
    });
  }
  return next();
});

const isAdmin = t.middleware(({ ctx, type, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  assertTokenAllowsCall(ctx, type);
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const isOperatorOrAbove = t.middleware(({ ctx, type, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  assertTokenAllowsCall(ctx, type);
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
/** Authenticated with a session, never an API token. */
const sessionProcedure = protectedProcedure.use(isSession);
/** Global admin with a session, never an API token. */
const adminSessionProcedure = adminProcedure.use(isSession);

export {
  createContext,
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  operatorProcedure,
  sessionProcedure,
  adminSessionProcedure,
};
