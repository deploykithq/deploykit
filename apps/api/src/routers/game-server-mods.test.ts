import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mods router guards that the services cannot see: what a project role may
 * read, and how often a user may make DeployKit call the catalogues.
 */

const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const row = {
  id: SERVER_ID,
  spec: { mods: { sources: [], modpacks: [], directories: [{ volume: "data", path: "mods" }] } },
  modpack: null,
};

const resolveServer = vi.fn();
const isRateLimited = vi.fn(async (_key: string, _limit: number, _window: number) => false);
const listFiles = vi.fn(async () => ({ entries: [{ name: "secret-plugin.jar", type: "file" }] }));
const checkUpdates = vi.fn(async () => []);
const listVersions = vi.fn(async () => []);

vi.mock("../db/index", () => ({ db: {} }));
vi.mock("../lib/redis", () => ({ gameBackupQueue: { add: vi.fn() }, isRateLimited }));
vi.mock("../lib/audit/audit", () => ({ logAction: vi.fn() }));
vi.mock("../services/game-catalog", () => ({ getGame: vi.fn(async () => row.spec) }));
vi.mock("../services/game-files", () => ({ listFiles }));
vi.mock("../services/game-server", () => ({ allValues: () => ({}) }));
vi.mock("../services/game-mods", () => ({
  listMods: vi.fn(async () => []),
  modsPending: vi.fn(async () => ({ pending: false, destructive: false })),
  resolveFilter: vi.fn(async () => null),
  checkUpdates,
  listVersions,
  GameModError: class extends Error {},
}));
vi.mock("./game-server-access", () => ({
  resolveServer: (...args: unknown[]) => resolveServer(...args),
  guarded: (fn: () => unknown) => fn(),
}));

const { gameServerModsRouter } = await import("./game-server-mods");

/** A global operator whose role on the server's project is `role`. */
const caller = (role: string) => {
  resolveServer.mockResolvedValue({ row, role });
  return gameServerModsRouter.createCaller({
    db: {} as any,
    ip: "t",
    user: { id: "u1", role: "operator" } as any,
  });
};

const VERSIONS_INPUT = {
  gameId: "minecraft-java",
  source: "modrinth",
  projectId: "AANobbMI",
  kind: "modpack",
} as const;

describe("mods.list", () => {
  beforeEach(() => listFiles.mockClear());

  it("does not show the files on disk to a project viewer", async () => {
    const out = await caller("viewer").list({ id: SERVER_ID });
    expect(out.onDisk).toEqual([]);
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("shows them to whoever may read the server's files", async () => {
    const out = await caller("admin").list({ id: SERVER_ID });
    expect(out.onDisk).toEqual([{ directory: "mods", files: ["secret-plugin.jar"] }]);
  });
});

describe("catalogue rate limits", () => {
  beforeEach(() => {
    isRateLimited.mockReset();
    isRateLimited.mockResolvedValue(false);
  });

  it("limits checkUpdates per user", async () => {
    await caller("viewer").checkUpdates({ id: SERVER_ID });
    expect(isRateLimited.mock.calls.map((c) => c[0])).toContain("mod-updates:u1");
    isRateLimited.mockResolvedValue(true);
    await expect(caller("viewer").checkUpdates({ id: SERVER_ID })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(checkUpdates).toHaveBeenCalledTimes(1);
  });

  it("limits versions per user, with or without a server", async () => {
    await caller("viewer").versions(VERSIONS_INPUT);
    expect(isRateLimited.mock.calls.map((c) => c[0])).toContain("mod-versions:u1");
    isRateLimited.mockResolvedValue(true);
    await expect(caller("viewer").versions(VERSIONS_INPUT)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
