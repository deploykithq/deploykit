import { describe, it, expect, vi } from "vitest";

/**
 * What an API token may and may not do, as enforced by the procedure
 * builders themselves — so no router has to remember the rule.
 */

vi.mock("./db/index", () => ({ db: {} }));

const {
  router,
  protectedProcedure,
  operatorProcedure,
  adminProcedure,
  sessionProcedure,
  adminSessionProcedure,
} = await import("./trpc");

const testRouter = router({
  read: protectedProcedure.query(() => "ok"),
  write: protectedProcedure.mutation(() => "ok"),
  operatorWrite: operatorProcedure.mutation(() => "ok"),
  adminRead: adminProcedure.query(() => "ok"),
  adminWrite: adminProcedure.mutation(() => "ok"),
  account: sessionProcedure.mutation(() => "ok"),
  accountRead: sessionProcedure.query(() => "ok"),
  manageUsers: adminSessionProcedure.query(() => "ok"),
});

const admin = { id: "u1", email: "a@example.com", role: "admin" } as any;
const token = (scope: "read" | "write") => ({ id: "t1", name: "agent", scope });

const caller = (apiToken: ReturnType<typeof token> | null, user = admin) =>
  testRouter.createCaller({ db: {} as any, user, ip: "127.0.0.1", apiToken });

describe("a session", () => {
  it("is unaffected by the token rules", async () => {
    const c = caller(null);
    await expect(c.write()).resolves.toBe("ok");
    await expect(c.adminWrite()).resolves.toBe("ok");
    await expect(c.account()).resolves.toBe("ok");
    await expect(c.manageUsers()).resolves.toBe("ok");
  });
});

describe("a read token", () => {
  const c = caller(token("read"));

  it("may query", async () => {
    await expect(c.read()).resolves.toBe("ok");
    await expect(c.adminRead()).resolves.toBe("ok");
  });

  it("may not mutate through any builder", async () => {
    for (const call of [c.write, c.operatorWrite, c.adminWrite]) {
      await expect(call()).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "This API token is read-only",
      });
    }
  });
});

describe("a write token", () => {
  const c = caller(token("write"));

  it("may mutate as its user", async () => {
    await expect(c.write()).resolves.toBe("ok");
    await expect(c.operatorWrite()).resolves.toBe("ok");
    await expect(c.adminWrite()).resolves.toBe("ok");
  });

  it("still answers to its user's global role", async () => {
    const viewer = caller(token("write"), { ...admin, role: "viewer" });
    await expect(viewer.operatorWrite()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.adminWrite()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("account management", () => {
  it("is closed to every token, even for queries", async () => {
    for (const scope of ["read", "write"] as const) {
      const c = caller(token(scope));
      await expect(c.accountRead()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.manageUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(caller(token("write")).account()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This action is not available to API tokens",
    });
  });

  it("still requires authentication first", async () => {
    const anonymous = testRouter.createCaller({
      db: {} as any,
      user: null,
      ip: "127.0.0.1",
      apiToken: null,
    });
    await expect(anonymous.account()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
