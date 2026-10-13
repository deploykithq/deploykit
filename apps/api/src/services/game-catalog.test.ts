import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The game catalogue shares the template registry's stale-while-error cache:
 * a registry outage keeps serving the last copy that validated, and only an
 * install that never reached the registry shows nothing.
 */

const redisMock = { get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() };

vi.mock("../lib/redis", () => ({ redis: redisMock }));
vi.mock("../lib/ssrf", () => ({ assertSafeUrl: async () => {} }));

const { listGames, getGame, refreshGameCatalog } = await import("./game-catalog");

const REGISTRY = "https://registry.test/catalogue";
const HOUR = 60 * 60 * 1000;

const META = {
  id: "terraria",
  name: "Terraria",
  version: "1",
  description: "2D sandbox.",
  logo: "logo.svg",
  tags: ["sandbox"],
};

const SPEC = {
  ...META,
  image: "example/terraria:1",
  ports: [{ name: "game", protocol: "tcp", container: 7777 }],
  volumes: [{ name: "world", path: "/world", primary: true }],
  console: { method: "stdin" },
  stop: { command: "exit" },
};

const cacheEntry = (value: unknown, ageMs = 0) =>
  JSON.stringify({ fetchedAt: Date.now() - ageMs, value });

const respondWith = (routes: Record<string, { status?: number; body: string }>) =>
  vi.fn(async (url: string) => {
    const match = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    if (!match) return { ok: false, status: 404, headers: new Headers(), text: async () => "" };
    const route = routes[match]!;
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      headers: new Headers(),
      text: async () => route.body,
    };
  });

beforeEach(() => {
  process.env.TEMPLATES_REGISTRY_URL = REGISTRY;
  for (const fn of Object.values(redisMock)) fn.mockReset();
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue("OK");
  redisMock.del.mockResolvedValue(1);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.TEMPLATES_REGISTRY_URL;
});

describe("listGames", () => {
  it("reads games/index.json and resolves logos under games/", async () => {
    vi.stubGlobal("fetch", respondWith({ "/games/index.json": { body: JSON.stringify([META]) } }));

    const result = await listGames();
    expect(result.source).toBe("remote");
    expect(result.games[0]!.logoUrl).toBe(`${REGISTRY}/games/terraria/logo.svg`);
    expect(redisMock.set).toHaveBeenCalledWith("games:index", expect.any(String), "EX", expect.any(Number));
  });

  it("serves a stale copy when the registry is down", async () => {
    redisMock.get.mockResolvedValue(cacheEntry([META], 2 * HOUR));
    vi.stubGlobal("fetch", respondWith({ "/games/index.json": { status: 500, body: "" } }));

    const result = await listGames();
    expect(result.source).toBe("stale");
    expect(result.games).toHaveLength(1);
  });

  it("reports unavailable rather than throwing when nothing is cached", async () => {
    vi.stubGlobal("fetch", respondWith({}));
    const result = await listGames();
    expect(result).toMatchObject({ source: "unavailable", games: [] });
  });
});

describe("getGame", () => {
  it("validates a definition and caches it", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ "/games/terraria/game.json": { body: JSON.stringify(SPEC) } }),
    );
    const game = await getGame("terraria");
    expect(game?.console).toEqual({ method: "stdin" });
    expect(redisMock.set).toHaveBeenCalledWith("games:def:terraria", expect.any(String), "EX", expect.any(Number));
  });

  it("refuses a definition served under an id that is not its own", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ "/games/terraria/game.json": { body: JSON.stringify({ ...SPEC, id: "evil" }) } }),
    );
    expect(await getGame("terraria")).toBeNull();
  });

  it("refuses a definition that fails the contract", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        "/games/terraria/game.json": { body: JSON.stringify({ ...SPEC, console: { method: "none" } }) },
      }),
    );
    // stop.command needs a console.
    expect(await getGame("terraria")).toBeNull();
  });

  it("does not let an id smuggle a path into the registry URL", async () => {
    const fetchMock = respondWith({});
    vi.stubGlobal("fetch", fetchMock);
    await getGame("../blueprints/x");
    expect(fetchMock.mock.calls[0]![0]).toBe(`${REGISTRY}/games/..%2Fblueprints%2Fx/game.json`);
  });
});

describe("refreshGameCatalog", () => {
  it("clears only game keys", async () => {
    redisMock.keys.mockResolvedValue(["games:index", "games:def:terraria"]);
    expect(await refreshGameCatalog()).toEqual({ cleared: 2 });
    expect(redisMock.keys).toHaveBeenCalledWith("games:*");
  });
});
