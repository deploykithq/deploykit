import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * CurseForge needs the instance's API key for everything, and some projects
 * forbid third-party distribution — the server image cannot download those,
 * so they are listed but not installable.
 */

vi.mock("../../lib/redis", () => ({
  redis: { get: vi.fn(async () => null), set: vi.fn(async () => "OK") },
}));

const { curseforge } = await import("./curseforge");

const ctx = { apiKey: "KEY" };
let calls: Array<{ url: string; headers: Record<string, string> }> = [];

const mockFetch = (routes: Record<string, unknown>, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      calls.push({ url, headers: init?.headers ?? {} });
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("", { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status });
    }),
  );

const MOD = {
  id: 238222,
  slug: "jei",
  name: "JEI",
  summary: "Items",
  logo: { thumbnailUrl: "https://t/x.png" },
  authors: [{ name: "mezz" }],
  downloadCount: 5,
  links: { websiteUrl: "https://www.curseforge.com/minecraft/mc-mods/jei" },
  allowModDistribution: true,
  classId: 6,
};

beforeEach(() => {
  calls = [];
  vi.unstubAllGlobals();
});

describe("curseforge", () => {
  it("needs a key for everything", () => {
    expect(curseforge.capabilities({ apiKey: null })).toMatchObject({
      search: false,
      install: false,
    });
    expect(curseforge.capabilities(ctx)).toMatchObject({ search: true, install: true });
  });

  it("parses CurseForge URLs and ids only", () => {
    expect(curseforge.parseRef("https://www.curseforge.com/minecraft/mc-mods/jei")).toBe("jei");
    expect(curseforge.parseRef("https://www.curseforge.com/minecraft/modpacks/all-the-mods-10")).toBe(
      "all-the-mods-10",
    );
    expect(curseforge.parseRef("238222")).toBe("238222");
    expect(curseforge.parseRef("https://modrinth.com/mod/jei")).toBeNull();
  });

  it("searches with class, loader type and version, sending the key", async () => {
    mockFetch({
      "/v1/mods/search": {
        data: [MOD],
        pagination: { index: 0, pageSize: 20, resultCount: 1, totalCount: 1 },
      },
    });
    const r = await curseforge.search(
      "jei",
      { loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4" },
      0,
      ctx,
    );
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("gameId")).toBe("432");
    expect(url.searchParams.get("classId")).toBe("6");
    expect(url.searchParams.get("modLoaderType")).toBe("4");
    expect(url.searchParams.get("gameVersion")).toBe("1.21.4");
    expect(calls[0]!.headers["x-api-key"]).toBe("KEY");
    expect(r.hits[0]).toMatchObject({ projectId: "238222", slug: "jei", installable: true });
  });

  it("uses the plugin and modpack classes", async () => {
    mockFetch({
      "/v1/mods/search": { data: [], pagination: { index: 0, pageSize: 20, totalCount: 0 } },
    });
    await curseforge.search("", { loaders: ["paper"], kind: "plugin", gameVersion: null }, 0, ctx);
    await curseforge.search("", { loaders: null, kind: "modpack", gameVersion: null }, 0, ctx);
    expect(new URL(calls[0]!.url).searchParams.get("classId")).toBe("5");
    expect(new URL(calls[0]!.url).searchParams.get("modLoaderType")).toBeNull();
    expect(new URL(calls[1]!.url).searchParams.get("classId")).toBe("4471");
  });

  it("refuses projects that forbid third-party distribution", async () => {
    mockFetch({ "/v1/mods/238222": { data: { ...MOD, allowModDistribution: false } } });
    const p = await curseforge.project("238222", ctx);
    expect(p.installable).toBe(false);
    expect(p.reason).toMatch(/distribution/i);
  });

  it("resolves a slug through search", async () => {
    mockFetch({
      "/v1/mods/search": { data: [MOD], pagination: { index: 0, pageSize: 1, totalCount: 1 } },
    });
    const p = await curseforge.project("jei", ctx);
    expect(new URL(calls[0]!.url).searchParams.get("slug")).toBe("jei");
    expect(p.projectId).toBe("238222");
  });

  it("maps files to versions with loaders and game versions split", async () => {
    mockFetch({
      "/v1/mods/238222/files": {
        data: [
          {
            id: 456,
            displayName: "jei-1.21.4-fabric-19.0",
            gameVersions: ["1.21.4", "Fabric"],
            fileDate: "2026-01-01",
            releaseType: 2,
          },
        ],
      },
    });
    const v = await curseforge.versions(
      "238222",
      { loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4" },
      ctx,
    );
    expect(v[0]).toEqual({
      id: "456",
      label: "jei-1.21.4-fabric-19.0",
      gameVersions: ["1.21.4"],
      loaders: ["fabric"],
      publishedAt: "2026-01-01",
      type: "beta",
    });
  });

  it("validates a key against the API", async () => {
    mockFetch({ "/v1/games/432": { data: { id: 432 } } });
    await expect(curseforge.validateKey!("KEY")).resolves.toBeUndefined();
    mockFetch({ "/v1/games/432": {} }, 403);
    await expect(curseforge.validateKey!("BAD")).rejects.toThrow(/rejected/);
  });
});
