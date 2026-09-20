import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The catalogue service: fetching blueprints from the registry and caching
 * them.
 *
 * Blueprints are not bundled into the image, so this is the only path by which
 * a template reaches the UI, and the cache is the only thing standing between
 * a registry outage and an empty Templates page. These tests are mostly about
 * that: what a user still gets when the registry is down, when the cache is
 * old, when it is poisoned, and when there is nothing at all.
 *
 * `lib/redis` opens real connections at import time, so it is mocked rather
 * than stubbed after the fact.
 */

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
};

const assertSafeUrl = vi.fn(async (_url: string): Promise<void> => {});

vi.mock("../lib/redis", () => ({ redis: redisMock }));
vi.mock("../lib/ssrf", () => ({
  assertSafeUrl: (url: string) => assertSafeUrl(url),
}));

const {
  listTemplates,
  getTemplate,
  refreshCatalog,
  parseTemplate,
  fetchTemplateFromUrl,
  registryUrl,
  DEFAULT_REGISTRY_URL,
} = await import("./template-catalog");

const REGISTRY = "https://registry.test/catalogue";
const HOUR = 60 * 60 * 1000;

const META = {
  id: "plausible",
  name: "Plausible",
  version: "1.2.3",
  description: "Privacy-friendly web analytics.",
  logo: "logo.svg",
  links: { github: "https://github.com/example/plausible" },
  tags: ["analytics"],
};

const SPEC = {
  ...META,
  variables: { main_domain: "${domain}" },
  domains: [{ service: "app", port: 8080, host: "${main_domain}" }],
  env: { BASE_URL: "https://${main_domain}" },
  mounts: [],
};

const COMPOSE = "services:\n  app:\n    image: example/plausible:1.2.3\n";

/** How the service stores a cache entry: a value plus when it was fetched. */
const cacheEntry = (value: unknown, ageMs = 0) =>
  JSON.stringify({ fetchedAt: Date.now() - ageMs, value });

/** A fetch stub that answers from a map of URL suffix -> response. */
const respondWith = (
  routes: Record<
    string,
    { status?: number; body: string; headers?: Record<string, string> }
  >,
) =>
  vi.fn(async (url: string) => {
    const match = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    if (!match) {
      return { ok: false, status: 404, headers: new Headers(), text: async () => "" };
    }
    const route = routes[match]!;
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(route.headers ?? {}),
      text: async () => route.body,
    };
  });

const INDEX_OK = { "/index.json": { body: JSON.stringify([META]) } };
const BLUEPRINT_OK = {
  "/blueprints/plausible/template.json": { body: JSON.stringify(SPEC) },
  "/blueprints/plausible/docker-compose.yml": { body: COMPOSE },
};

let fetchMock: ReturnType<typeof respondWith>;
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TEMPLATES_REGISTRY_URL = REGISTRY;
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue("OK");
  redisMock.del.mockResolvedValue(1);
  redisMock.keys.mockResolvedValue([]);
  assertSafeUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.TEMPLATES_REGISTRY_URL;
  vi.unstubAllGlobals();
});

describe("registryUrl", () => {
  it("falls back to the public catalogue when unset", () => {
    delete process.env.TEMPLATES_REGISTRY_URL;
    expect(registryUrl()).toBe(DEFAULT_REGISTRY_URL);
  });

  it("strips trailing slashes so joined paths never double up", () => {
    process.env.TEMPLATES_REGISTRY_URL = "https://registry.test/cat///";
    expect(registryUrl()).toBe("https://registry.test/cat");
  });
});

describe("listTemplates", () => {
  it("serves the registry index and caches it with a timestamp", async () => {
    fetchMock = respondWith(INDEX_OK);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTemplates();

    expect(result.source).toBe("remote");
    expect(result.templates.map((t) => t.id)).toEqual(["plausible"]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${REGISTRY}/index.json`,
      expect.anything(),
    );

    const [key, payload, mode, ttl] = redisMock.set.mock.calls[0]!;
    expect(key).toBe("templates:index");
    expect(mode).toBe("EX");
    expect(ttl).toBe(30 * 24 * 60 * 60);
    expect(JSON.parse(payload as string).fetchedAt).toBeTypeOf("number");
  });

  it("resolves a logo to a URL under the registry", async () => {
    fetchMock = respondWith(INDEX_OK);
    vi.stubGlobal("fetch", fetchMock);

    const { templates } = await listTemplates();

    expect(templates[0]!.logoUrl).toBe(
      `${REGISTRY}/blueprints/plausible/logo.svg`,
    );
  });

  it("serves a fresh cache without touching the network", async () => {
    redisMock.get.mockResolvedValue(cacheEntry([META], 5 * 60 * 1000));
    fetchMock = respondWith(INDEX_OK);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTemplates();

    expect(result.source).toBe("remote");
    expect(result.templates).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-reads the registry once the cache is an hour old", async () => {
    redisMock.get.mockResolvedValue(cacheEntry([META], 2 * HOUR));
    fetchMock = respondWith(INDEX_OK);
    vi.stubGlobal("fetch", fetchMock);

    await listTemplates();

    expect(fetchMock).toHaveBeenCalled();
  });

  it("keeps serving a stale cache when the registry is unreachable", async () => {
    // The whole reason the cache has a 30-day life: nothing is bundled, so
    // this is what stands between an outage and an empty page.
    redisMock.get.mockResolvedValue(cacheEntry([META], 3 * HOUR));
    fetchMock = respondWith({ "/index.json": { status: 503, body: "" } });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTemplates();

    expect(result.source).toBe("stale");
    expect(result.templates.map((t) => t.id)).toEqual(["plausible"]);
    expect(result.error).toMatch(/503/);
    // The good copy must survive; overwriting it with the failure loses it.
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("reports an empty catalogue rather than throwing when nothing is cached", async () => {
    fetchMock = respondWith({ "/index.json": { status: 500, body: "" } });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTemplates();

    expect(result.source).toBe("unavailable");
    expect(result.templates).toEqual([]);
    expect(result.error).toMatch(/500/);
  });

  it.each([
    ["malformed JSON", "not json"],
    ["a payload that is not a catalogue", JSON.stringify({ hello: "world" })],
  ])("treats %s from the registry as an outage", async (_case, body) => {
    fetchMock = respondWith({ "/index.json": { body } });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTemplates();

    expect(result.source).toBe("unavailable");
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("drops a cache entry that no longer validates and re-fetches", async () => {
    redisMock.get.mockResolvedValue(cacheEntry([{ id: "x" }]));
    fetchMock = respondWith(INDEX_OK);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTemplates();

    expect(redisMock.del).toHaveBeenCalledWith("templates:index");
    expect(result.source).toBe("remote");
  });

  it("treats a cache entry written by an older format as absent", async () => {
    redisMock.get.mockResolvedValue(JSON.stringify([META])); // no fetchedAt
    fetchMock = respondWith(INDEX_OK);
    vi.stubGlobal("fetch", fetchMock);

    expect((await listTemplates()).source).toBe("remote");
    expect(redisMock.del).toHaveBeenCalledWith("templates:index");
  });

  it("refuses a registry that resolves to a private address", async () => {
    assertSafeUrl.mockRejectedValue(
      new Error("URL resolves to a non-public address"),
    );
    fetchMock = respondWith(INDEX_OK);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTemplates();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source).toBe("unavailable");
  });

  it("rejects a response that declares a size no catalogue index has", async () => {
    fetchMock = respondWith({
      "/index.json": {
        body: JSON.stringify([META]),
        headers: { "content-length": "9000000" },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await listTemplates()).source).toBe("unavailable");
  });

  it("warns when it degrades, so an operator can tell from the logs", async () => {
    fetchMock = respondWith({ "/index.json": { status: 500, body: "" } });
    vi.stubGlobal("fetch", fetchMock);

    await listTemplates();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("nothing is cached"),
    );
  });
});

describe("getTemplate", () => {
  it("assembles a blueprint from its two files and caches it", async () => {
    fetchMock = respondWith(BLUEPRINT_OK);
    vi.stubGlobal("fetch", fetchMock);

    const template = await getTemplate("plausible");

    expect(template?.spec.id).toBe("plausible");
    expect(template?.compose).toBe(COMPOSE);
    expect(redisMock.set.mock.calls[0]![0]).toBe("templates:blueprint:plausible");
  });

  it("serves a fresh cache without touching the network", async () => {
    redisMock.get.mockResolvedValue(
      cacheEntry({ spec: SPEC, compose: COMPOSE }, 10 * 60 * 1000),
    );
    fetchMock = respondWith(BLUEPRINT_OK);
    vi.stubGlobal("fetch", fetchMock);

    expect((await getTemplate("plausible"))?.spec.id).toBe("plausible");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deploys the cached copy when the registry cannot be refreshed", async () => {
    redisMock.get.mockResolvedValue(
      cacheEntry({ spec: SPEC, compose: COMPOSE }, 5 * HOUR),
    );
    fetchMock = respondWith({});
    vi.stubGlobal("fetch", fetchMock);

    expect((await getTemplate("plausible"))?.compose).toBe(COMPOSE);
  });

  it("refuses a blueprint served under an id that is not its own", async () => {
    fetchMock = respondWith({
      "/blueprints/gitea/template.json": { body: JSON.stringify(SPEC) },
      "/blueprints/gitea/docker-compose.yml": { body: COMPOSE },
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getTemplate("gitea")).toBeNull();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("returns null when the registry has no such blueprint", async () => {
    fetchMock = respondWith({});
    vi.stubGlobal("fetch", fetchMock);

    expect(await getTemplate("does-not-exist")).toBeNull();
  });

  it("does not let an id smuggle a path into the registry URL", async () => {
    fetchMock = respondWith({});
    vi.stubGlobal("fetch", fetchMock);

    await getTemplate("../../etc/passwd");

    for (const [url] of fetchMock.mock.calls) {
      expect(url).toContain("%2F");
      expect(url).not.toContain("/../");
    }
  });
});

describe("refreshCatalog", () => {
  it("clears every catalogue key", async () => {
    redisMock.keys.mockResolvedValue([
      "templates:index",
      "templates:blueprint:gitea",
    ]);

    expect(await refreshCatalog()).toEqual({ cleared: 2 });
    expect(redisMock.del).toHaveBeenCalledWith(
      "templates:index",
      "templates:blueprint:gitea",
    );
  });

  it("does not call del with an empty key list", async () => {
    redisMock.keys.mockResolvedValue([]);

    expect(await refreshCatalog()).toEqual({ cleared: 0 });
    expect(redisMock.del).not.toHaveBeenCalled();
  });
});

describe("parseTemplate", () => {
  it("accepts a well-formed blueprint", () => {
    expect(parseTemplate(JSON.stringify(SPEC), COMPOSE).spec.name).toBe(
      "Plausible",
    );
  });

  it("reports invalid JSON as such rather than as a schema error", () => {
    expect(() => parseTemplate("{ nope", COMPOSE)).toThrow(/not valid JSON/);
  });

  it("rejects a spec that does not match the schema", () => {
    const bad = { ...SPEC, id: "Not A Valid Id" };
    expect(() => parseTemplate(JSON.stringify(bad), COMPOSE)).toThrow();
  });
});

describe("fetchTemplateFromUrl", () => {
  it("reads both files from the base URL the user gave", async () => {
    fetchMock = respondWith({
      "/template.json": { body: JSON.stringify(SPEC) },
      "/docker-compose.yml": { body: COMPOSE },
    });
    vi.stubGlobal("fetch", fetchMock);

    const template = await fetchTemplateFromUrl("https://example.test/mine/");

    expect(template.spec.id).toBe("plausible");
    expect(assertSafeUrl).toHaveBeenCalledWith(
      "https://example.test/mine/template.json",
    );
  });

  it("propagates the failure instead of silently importing nothing", async () => {
    fetchMock = respondWith({});
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchTemplateFromUrl("https://example.test/gone"),
    ).rejects.toThrow();
  });
});
