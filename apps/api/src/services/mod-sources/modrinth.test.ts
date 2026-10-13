import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Modrinth: public API, no key. Search is pre-filtered to what fits the
 * server (loader, version, server side), and pasted links are parsed for a
 * slug — never fetched.
 */

const redisMock = { get: vi.fn(async () => null), set: vi.fn(async () => "OK") };
vi.mock("../../lib/redis", () => ({ redis: redisMock }));

const { modrinth, resolveVersionAlias } = await import("./modrinth");
const { ModSourceError } = await import("./http");

const ctx = { apiKey: null };
let calls: string[] = [];

const mockFetch = (routes: Record<string, unknown>, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status });
    }),
  );

beforeEach(() => {
  calls = [];
  vi.unstubAllGlobals();
});

describe("modrinth.parseRef", () => {
  it("accepts slugs, ids and modrinth URLs only", () => {
    expect(modrinth.parseRef("lithium")).toBe("lithium");
    expect(modrinth.parseRef("https://modrinth.com/mod/lithium")).toBe("lithium");
    expect(modrinth.parseRef("https://modrinth.com/modpack/adrenaserver/version/1.2")).toBe(
      "adrenaserver",
    );
    expect(modrinth.parseRef("https://evil.example/mod/lithium")).toBeNull();
    expect(modrinth.parseRef("https://www.curseforge.com/minecraft/mc-mods/jei")).toBeNull();
    expect(modrinth.parseRef("../etc")).toBeNull();
    // A dot-segment from a link would walk the API path: /v2/project/.. → /v2/
    expect(modrinth.parseRef("https://modrinth.com/mod/..")).toBeNull();
    expect(modrinth.parseRef("https://modrinth.com/mod/.")).toBeNull();
  });
});

describe("modrinth.search", () => {
  it("filters by loader, version, kind and server side", async () => {
    mockFetch({
      "/v2/search": {
        hits: [
          {
            project_id: "gvQqBUqZ",
            slug: "lithium",
            title: "Lithium",
            description: "Fast",
            icon_url: "https://cdn/x.png",
            author: "jelly",
            downloads: 10,
            project_type: "mod",
            server_side: "optional",
          },
        ],
        offset: 0,
        limit: 20,
        total_hits: 1,
      },
    });
    const r = await modrinth.search(
      "lith",
      { loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4" },
      0,
      ctx,
    );
    const facets = JSON.parse(new URL(calls[0]!).searchParams.get("facets")!);
    expect(facets).toContainEqual(["categories:fabric"]);
    expect(facets).toContainEqual(["versions:1.21.4"]);
    expect(facets).toContainEqual(["project_type:mod"]);
    expect(facets).toContainEqual(["server_side:required", "server_side:optional"]);
    expect(r.hits[0]).toMatchObject({ projectId: "gvQqBUqZ", name: "Lithium", installable: true });
    expect(r.total).toBe(1);
  });

  it("searches plugins as mod-or-plugin project types", async () => {
    mockFetch({ "/v2/search": { hits: [], offset: 0, limit: 20, total_hits: 0 } });
    await modrinth.search(
      "",
      { loaders: ["paper", "bukkit"], kind: "plugin", gameVersion: null },
      0,
      ctx,
    );
    const facets = JSON.parse(new URL(calls[0]!).searchParams.get("facets")!);
    expect(facets).toContainEqual(["categories:paper", "categories:bukkit"]);
    expect(facets).toContainEqual(["project_type:mod", "project_type:plugin"]);
  });

  it("keeps only modpacks that run on a server", async () => {
    mockFetch({ "/v2/search": { hits: [], offset: 0, limit: 20, total_hits: 0 } });
    await modrinth.search("", { loaders: null, kind: "modpack", gameVersion: null }, 0, ctx);
    const facets = JSON.parse(new URL(calls[0]!).searchParams.get("facets")!);
    expect(facets).toContainEqual(["project_type:modpack"]);
    expect(facets).toContainEqual(["server_side:required", "server_side:optional"]);
  });
});

describe("modrinth.project / versions", () => {
  it("marks client-only projects not installable", async () => {
    mockFetch({
      "/v2/project/sodium": {
        id: "AANobbMI",
        slug: "sodium",
        title: "Sodium",
        description: "x",
        icon_url: null,
        downloads: 1,
        project_type: "mod",
        server_side: "unsupported",
      },
    });
    const p = await modrinth.project("sodium", ctx);
    expect(p.installable).toBe(false);
    expect(p.reason).toMatch(/client/i);
  });

  it("marks client-only modpacks not installable too", async () => {
    mockFetch({
      "/v2/project/sodiumplus": {
        id: "ch7UHY2J",
        slug: "sodiumplus",
        title: "Sodium Plus",
        description: "x",
        downloads: 1,
        project_type: "modpack",
        server_side: "unsupported",
      },
    });
    const p = await modrinth.project("sodiumplus", ctx);
    expect(p.kind).toBe("modpack");
    expect(p.installable).toBe(false);
  });

  it("maps versions", async () => {
    mockFetch({
      "/version": [
        {
          id: "v2",
          version_number: "2.0",
          game_versions: ["1.21.4"],
          loaders: ["fabric"],
          date_published: "2026-02-01",
          version_type: "release",
        },
      ],
    });
    const v = await modrinth.versions(
      "AA",
      { loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4" },
      ctx,
    );
    expect(v[0]).toEqual({
      id: "v2",
      label: "2.0",
      gameVersions: ["1.21.4"],
      loaders: ["fabric"],
      publishedAt: "2026-02-01",
      type: "release",
    });
    const url = new URL(calls[0]!);
    expect(JSON.parse(url.searchParams.get("loaders")!)).toEqual(["fabric"]);
    expect(JSON.parse(url.searchParams.get("game_versions")!)).toEqual(["1.21.4"]);
  });

  it("turns a 404 into NOT_FOUND", async () => {
    mockFetch({});
    await expect(modrinth.project("missing", ctx)).rejects.toBeInstanceOf(ModSourceError);
    await expect(modrinth.project("missing", ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("resolveVersionAlias", () => {
  it("picks the newest release, or the newest of any type", async () => {
    mockFetch({
      "/v2/tag/game_version": [
        { version: "26w10a", version_type: "snapshot" },
        { version: "1.21.4", version_type: "release" },
      ],
    });
    expect(await resolveVersionAlias("release")).toBe("1.21.4");
    expect(await resolveVersionAlias("any")).toBe("26w10a");
  });
});
