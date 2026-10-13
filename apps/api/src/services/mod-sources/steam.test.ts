import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Steam Workshop: an item is looked up without a key (so pasting a link
 * always works), searching needs a Steam Web API key, and an item must
 * belong to the game's Workshop app.
 */

vi.mock("../../lib/redis", () => ({
  redis: { get: vi.fn(async () => null), set: vi.fn(async () => "OK") },
}));

const { steamWorkshop } = await import("./steam");

let calls: Array<{ url: string; body?: string }> = [];
const mockFetch = (routes: Record<string, unknown>, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      calls.push({ url, body: init?.body });
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("", { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status });
    }),
  );

const ITEM = (overrides: Record<string, unknown> = {}) => ({
  result: 1,
  publishedfileid: "2669644269",
  title: "Boss Checklist",
  description: "x",
  preview_url: "https://img/p.png",
  consumer_app_id: 1281930,
  time_updated: 1767225600,
  subscriptions: 900,
  ...overrides,
});
const DETAILS = (overrides: Record<string, unknown> = {}) => ({
  response: { publishedfiledetails: [ITEM(overrides)] },
});
const TML = { apiKey: null, appId: 1281930 };

beforeEach(() => {
  calls = [];
  vi.unstubAllGlobals();
});

describe("steamWorkshop", () => {
  it("installs without a key but only searches with one", () => {
    expect(steamWorkshop.capabilities(TML)).toMatchObject({ search: false, install: true });
    expect(steamWorkshop.capabilities({ ...TML, apiKey: "K" })).toMatchObject({
      search: true,
      install: true,
    });
  });

  it("parses Workshop URLs and numeric ids only", () => {
    expect(
      steamWorkshop.parseRef("https://steamcommunity.com/sharedfiles/filedetails/?id=2669644269"),
    ).toBe("2669644269");
    expect(
      steamWorkshop.parseRef(
        "https://steamcommunity.com/workshop/filedetails/?id=2669644269&searchtext=",
      ),
    ).toBe("2669644269");
    expect(steamWorkshop.parseRef("2669644269")).toBe("2669644269");
    expect(steamWorkshop.parseRef("boss-checklist")).toBeNull();
    expect(steamWorkshop.parseRef("https://evil.example/?id=1")).toBeNull();
  });

  it("looks a project up without a key and checks the app", async () => {
    mockFetch({ GetPublishedFileDetails: DETAILS() });
    const p = await steamWorkshop.project("2669644269", TML);
    expect(calls[0]!.body).toContain("publishedfileids%5B0%5D=2669644269");
    expect(p).toMatchObject({ projectId: "2669644269", name: "Boss Checklist", installable: true });
  });

  it("refuses an item from another game", async () => {
    mockFetch({ GetPublishedFileDetails: DETAILS({ consumer_app_id: 105600 }) });
    await expect(steamWorkshop.project("2669644269", TML)).rejects.toThrow(/another game/i);
  });

  it("refuses a missing or private item", async () => {
    mockFetch({ GetPublishedFileDetails: DETAILS({ result: 9 }) });
    await expect(steamWorkshop.project("2669644269", TML)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns one unpinnable version labelled with the update date", async () => {
    mockFetch({ GetPublishedFileDetails: DETAILS() });
    const v = await steamWorkshop.versions("2669644269", null, TML);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ id: "1767225600", type: "release" });
    expect(v[0]!.label).toMatch(/2026-01-01/);
  });

  it("searches through QueryFiles with the key", async () => {
    mockFetch({
      QueryFiles: { response: { total: 1, publishedfiledetails: [ITEM()] } },
    });
    const r = await steamWorkshop.search(
      "boss",
      { loaders: null, kind: "mod", gameVersion: null },
      20,
      { ...TML, apiKey: "K" },
    );
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("appid")).toBe("1281930");
    expect(url.searchParams.get("search_text")).toBe("boss");
    expect(url.searchParams.get("page")).toBe("2");
    expect(r.hits[0]!.name).toBe("Boss Checklist");
  });
});
