import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** A stand-in Redis with just the commands the manifest flow uses. */
const store = new Map<string, string>();
const redisStub = {
  set: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
    return "OK";
  }),
  getdel: vi.fn(async (k: string) => {
    const v = store.get(k) ?? null;
    store.delete(k);
    return v;
  }),
};

vi.mock("../lib/redis", () => ({ redis: redisStub }));

let mod: typeof import("./github-manifest");
const ORIGINAL_WEB_URL = process.env.WEB_URL;

beforeEach(async () => {
  store.clear();
  vi.clearAllMocks();
  vi.resetModules();
  process.env.WEB_URL = "https://deploy.acme.io";
  mod = await import("./github-manifest");
});

afterEach(() => {
  if (ORIGINAL_WEB_URL === undefined) delete process.env.WEB_URL;
  else process.env.WEB_URL = ORIGINAL_WEB_URL;
});

describe("manifestUrls", () => {
  it("derives the webhook and redirect URLs from WEB_URL", () => {
    const urls = mod.manifestUrls();
    expect(urls.webhookUrl).toBe("https://deploy.acme.io/api/webhooks/github");
    expect(urls.redirectUrl).toBe(
      "https://deploy.acme.io/settings/github/callback",
    );
  });

  it("tolerates a trailing slash on WEB_URL", () => {
    process.env.WEB_URL = "https://deploy.acme.io/";
    expect(mod.manifestUrls().webhookUrl).toBe(
      "https://deploy.acme.io/api/webhooks/github",
    );
  });

  it("refuses to guess when WEB_URL is unset", () => {
    delete process.env.WEB_URL;
    expect(() => mod.manifestUrls()).toThrow(/WEB_URL/);
  });
});

describe("assertWebhookReachable", () => {
  it("accepts a public host", () => {
    expect(() => mod.assertWebhookReachable(mod.manifestUrls())).not.toThrow();
  });

  it("rejects localhost, since GitHub could never deliver there", () => {
    process.env.WEB_URL = "http://localhost:5173";
    expect(() => mod.assertWebhookReachable(mod.manifestUrls())).toThrow(
      /cannot reach/i,
    );
  });

  it("rejects a private address", () => {
    process.env.WEB_URL = "http://192.168.1.10:3000";
    expect(() => mod.assertWebhookReachable(mod.manifestUrls())).toThrow(
      /cannot reach/i,
    );
  });
});

describe("buildManifest", () => {
  it("asks for exactly the four permissions the features need", () => {
    const manifest = mod.buildManifest(mod.manifestUrls());
    expect(manifest.default_permissions).toEqual({
      metadata: "read",
      contents: "read",
      statuses: "write",
      pull_requests: "write",
    });
  });

  it("subscribes to push and pull_request, and to nothing else", () => {
    // installation / installation_repositories are deliberately absent: every
    // App receives them automatically and they cannot be subscribed to.
    const manifest = mod.buildManifest(mod.manifestUrls());
    expect(manifest.default_events.sort()).toEqual(["pull_request", "push"]);
  });

  it("registers the webhook and both redirect URLs, and stays private", () => {
    const urls = mod.manifestUrls();
    const manifest = mod.buildManifest(urls);
    expect(manifest.hook_attributes).toEqual({
      url: urls.webhookUrl,
      active: true,
    });
    expect(manifest.redirect_url).toBe(urls.redirectUrl);
    // setup_url is what GitHub returns to after an install, which is how an
    // installation is recorded when the webhook does not arrive.
    expect(manifest.setup_url).toBe(urls.redirectUrl);
    expect(manifest.public).toBe(false);
  });

  it("defaults the name to something unique per host", () => {
    // App names are globally unique on GitHub, so a bare "DeployKit" would
    // collide with the first person who registered one.
    expect(mod.buildManifest(mod.manifestUrls()).name).toBe(
      "DeployKit - deploy.acme.io",
    );
    expect(mod.buildManifest(mod.manifestUrls(), "Acme Deploys").name).toBe(
      "Acme Deploys",
    );
  });
});

describe("manifestPostUrl", () => {
  it("targets the personal account by default", () => {
    expect(mod.manifestPostUrl("abc")).toBe(
      "https://github.com/settings/apps/new?state=abc",
    );
  });

  it("targets an organization when one is given", () => {
    expect(mod.manifestPostUrl("abc", "acme corp")).toBe(
      "https://github.com/organizations/acme%20corp/settings/apps/new?state=abc",
    );
  });
});

describe("manifest state", () => {
  it("round-trips for the admin who started the flow", async () => {
    const state = await mod.issueManifestState("user-1");
    expect(await mod.consumeManifestState(state, "user-1")).toBe(true);
  });

  it("cannot be used twice", async () => {
    const state = await mod.issueManifestState("user-1");
    expect(await mod.consumeManifestState(state, "user-1")).toBe(true);
    expect(await mod.consumeManifestState(state, "user-1")).toBe(false);
  });

  it("is bound to its admin", async () => {
    const state = await mod.issueManifestState("user-1");
    expect(await mod.consumeManifestState(state, "user-2")).toBe(false);
  });

  it("rejects an empty or unknown state", async () => {
    expect(await mod.consumeManifestState("", "user-1")).toBe(false);
    expect(await mod.consumeManifestState("made-up", "user-1")).toBe(false);
  });
});

describe("installUrl", () => {
  it("points at the App's install page", () => {
    expect(mod.installUrl("https://github.com", "deploykit-acme")).toBe(
      "https://github.com/apps/deploykit-acme/installations/new",
    );
  });
});
