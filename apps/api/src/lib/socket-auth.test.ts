import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The web terminal is arbitrary execution in a container, so it needs both
 * layers: an operator+ global role AND operator+ on the project that owns the
 * container. A global operator who is only a viewer of (or a stranger to) a
 * project must not get a shell in its containers.
 */

const getProjectRole = vi.fn();
const findApp = vi.fn(async (_args?: unknown) => undefined as unknown);
const none = { findFirst: vi.fn(async () => undefined) };

vi.mock("../db/index", () => ({
  db: {
    query: {
      applications: { findFirst: (args: unknown) => findApp(args) },
      databases: none,
      gameServers: none,
      composeServices: none,
    },
  },
}));
vi.mock("./permissions", async (orig) => ({
  ...(await orig<typeof import("./permissions")>()),
  getProjectRole: (...args: unknown[]) => getProjectRole(...args),
}));

const { terminalAccess } = await import("./socket-auth");

/** Whether a (circular) drizzle query object mentions `value` anywhere. */
const mentions = (obj: unknown, value: string): boolean => {
  const seen = new WeakSet();
  const walk = (o: unknown): boolean => {
    if (o === value) return true;
    if (!o || typeof o !== "object" || seen.has(o)) return false;
    seen.add(o);
    return Object.values(o).some(walk);
  };
  return walk(obj);
};

const user = (role: string) => ({ id: "u1", role }) as any;
const APP_ID = "11111111-1111-4111-8111-111111111111";
const appLabels = { "deploykit.managed": "true", "deploykit.service": APP_ID };

describe("terminalAccess", () => {
  beforeEach(() => {
    getProjectRole.mockReset();
    findApp.mockReset();
    findApp.mockResolvedValue({ projectId: "p1" });
  });

  it("refuses a global viewer before looking at the container", async () => {
    expect(await terminalAccess(user("viewer"), appLabels, "c1")).toBe("forbidden");
    expect(getProjectRole).not.toHaveBeenCalled();
  });

  it("hides the container from a global operator who is not a member", async () => {
    getProjectRole.mockResolvedValue(null);
    expect(await terminalAccess(user("operator"), appLabels, "c1")).toBe("not_found");
  });

  it("refuses a global operator who is only a viewer of the project", async () => {
    getProjectRole.mockResolvedValue("viewer");
    expect(await terminalAccess(user("operator"), appLabels, "c1")).toBe("forbidden");
  });

  it("allows an operator of the owning project", async () => {
    getProjectRole.mockResolvedValue("operator");
    expect(await terminalAccess(user("operator"), appLabels, "c1")).toBe("ok");
    expect(getProjectRole).toHaveBeenCalledWith(expect.anything(), "p1");
  });

  it("resolves the project from the service label, so every replica is covered", async () => {
    getProjectRole.mockResolvedValue("operator");
    await terminalAccess(user("operator"), appLabels, "replica-container-id");
    expect(mentions(findApp.mock.calls[0], APP_ID)).toBe(true);
    expect(mentions(findApp.mock.calls[0], "replica-container-id")).toBe(false);
  });

  it("refuses containers that belong to no project (helpers, one-offs, foreign)", async () => {
    findApp.mockResolvedValue(undefined);
    expect(
      await terminalAccess(user("admin"), { "deploykit.managed": "true" }, "c1"),
    ).toBe("not_found");
  });
});
