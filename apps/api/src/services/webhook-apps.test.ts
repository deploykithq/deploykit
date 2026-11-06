import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHmac } from "crypto";

/**
 * Webhook verification and installation bookkeeping with several GitHub Apps.
 *
 * An instance registers one private App per account it deploys from, so a
 * delivery has to be matched to the App whose secret signed it — and an
 * `installation` event filed under that App, never under one a header names.
 */

const PERSONAL = {
  id: "personal-app",
  appId: 111,
  webhookSecret: "secret-personal",
};
const ORG = { id: "org-app", appId: 222, webhookSecret: "secret-org" };
const LEGACY = "legacy-webhook-secret";

const inserted: any[] = [];

vi.mock("../db/index", () => {
  const apps = [PERSONAL, ORG];
  return {
    db: {
      query: {
        // No test sends the target-id header, so every App is a candidate.
        githubApps: { findMany: vi.fn(async () => apps) },
      },
      insert: () => ({
        values: (v: any) => ({
          onConflictDoUpdate: async () => {
            inserted.push(v);
          },
        }),
      }),
      delete: () => ({ where: async () => undefined }),
    },
  };
});
vi.mock("../lib/encryption", () => ({ decrypt: (s: string) => s }));
vi.mock("../lib/redis", () => ({ deployQueue: {} }));
vi.mock("./docker-factory", () => ({ getDockerForServer: vi.fn() }));
vi.mock("./github-status", () => ({
  publishDeployStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
}));
vi.mock("./github-app", () => ({
  getInstallationByGithubId: vi.fn(async () => null),
  invalidateRepositoryCache: vi.fn(async () => undefined),
}));

let WebhookService: typeof import("./webhook").WebhookService;

beforeAll(async () => {
  process.env.WEBHOOK_SECRET = LEGACY;
  ({ WebhookService } = await import("./webhook"));
});

beforeEach(() => {
  inserted.length = 0;
});

const raw = Buffer.from(JSON.stringify({ action: "created" }), "utf8");
const sign = (secret: string) =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

describe("verifyGitHubDelivery", () => {
  it("names the App whose secret signed the delivery", async () => {
    const svc = new WebhookService();
    expect(await svc.verifyGitHubDelivery(raw, sign("secret-org"))).toEqual({
      ok: true,
      appRowId: "org-app",
    });
    expect(
      await svc.verifyGitHubDelivery(raw, sign("secret-personal")),
    ).toEqual({ ok: true, appRowId: "personal-app" });
  });

  it("accepts the legacy secret without attributing it to any App", async () => {
    const svc = new WebhookService();
    expect(await svc.verifyGitHubDelivery(raw, sign(LEGACY))).toEqual({
      ok: true,
      appRowId: null,
    });
  });

  it("rejects a secret that belongs to none of them", async () => {
    const svc = new WebhookService();
    expect(await svc.verifyGitHubDelivery(raw, sign("nope"))).toEqual({
      ok: false,
      appRowId: null,
    });
  });
});

describe("installation events", () => {
  const payload = {
    action: "created",
    installation: {
      id: 9001,
      account: { login: "acme-inc", type: "Organization", id: 5 },
      repository_selection: "selected",
    },
  };
  const headers = { "x-github-event": "installation" };

  it("files the installation under the App that signed it", async () => {
    const svc = new WebhookService();
    await svc.handleGitHub(payload, headers, "org-app");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      githubAppId: "org-app",
      installationId: 9001,
      accountLogin: "acme-inc",
    });
  });

  it("ignores an installation event signed only with WEBHOOK_SECRET", async () => {
    const svc = new WebhookService();
    const res = await svc.handleGitHub(payload, headers, null);
    expect(res.triggered).toBe(false);
    expect(res.message).toMatch(/not signed by a GitHub App/);
    expect(inserted).toHaveLength(0);
  });
});
