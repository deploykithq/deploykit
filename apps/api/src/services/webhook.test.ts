import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "crypto";

const SECRET = "test-webhook-secret";

/**
 * WebhookService reads WEBHOOK_SECRET at module load, so the env has to be in
 * place before the first import.
 */
let WebhookService: typeof import("./webhook").WebhookService;
let matchApplications: typeof import("./webhook").matchApplications;

beforeAll(async () => {
  process.env.WEBHOOK_SECRET = SECRET;
  ({ WebhookService, matchApplications } = await import("./webhook"));
});

const sign = (raw: Buffer, secret = SECRET) =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

describe("verifyGitHubSignature", () => {
  it("accepts a signature over the raw bytes", async () => {
    const svc = new WebhookService();
    const raw = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }), "utf8");
    expect(await svc.verifyGitHubSignature(raw, sign(raw))).toBe(true);
  });

  it("rejects a signature made with a different secret", async () => {
    const svc = new WebhookService();
    const raw = Buffer.from("{}", "utf8");
    expect(await svc.verifyGitHubSignature(raw, sign(raw, "other"))).toBe(
      false,
    );
  });

  it("rejects a missing or malformed signature header", async () => {
    const svc = new WebhookService();
    const raw = Buffer.from("{}", "utf8");
    expect(await svc.verifyGitHubSignature(raw, undefined)).toBe(false);
    expect(await svc.verifyGitHubSignature(raw, "sha256=nope")).toBe(false);
  });

  /**
   * The regression this whole raw-body change exists for: the route used to
   * hash JSON.stringify(req.body), which re-serializes what GitHub sent. A
   * payload carrying an escaped non-ASCII character round-trips to different
   * bytes, so its signature no longer matched and the delivery was dropped.
   */
  it("verifies a payload whose JSON escaping differs from its re-serialization", async () => {
    const svc = new WebhookService();
    // Built without a source-level escape so the file's own encoding can't
    // quietly turn this into the literal character.
    const BACKSLASH = String.fromCharCode(92);
    const escaped = Buffer.from(
      `{"message":"caf${BACKSLASH}u00e9"}`,
      "utf8",
    );
    const reserialized = Buffer.from(
      JSON.stringify(JSON.parse(escaped.toString("utf8"))),
      "utf8",
    );

    // The two encodings really are different bytes...
    expect(escaped.equals(reserialized)).toBe(false);
    // ...and only the bytes GitHub actually signed verify.
    expect(await svc.verifyGitHubSignature(escaped, sign(escaped))).toBe(true);
    expect(await svc.verifyGitHubSignature(reserialized, sign(escaped))).toBe(
      false,
    );
  });
});

const APP_URL = "https://github.com/acme/api.git";
const INSTALLATION_ROW = "aaaaaaaa-0000-0000-0000-000000000001";

/** Just the columns the matcher looks at. */
const candidate = (over: Record<string, unknown> = {}) =>
  ({
    id: "app-1",
    repositoryUrl: APP_URL,
    githubInstallationId: null,
    githubRepoId: null,
    ...over,
  }) as any;

describe("matchApplications", () => {
  it("matches an unconnected app by normalized URL", () => {
    const apps = [candidate()];
    const matched = matchApplications(apps, {
      repoUrl: "https://GitHub.com/acme/api/",
      branch: "main",
    });
    expect(matched).toHaveLength(1);
  });

  it("matches a connected app by installation and repo id", () => {
    const apps = [
      candidate({
        id: "connected",
        githubInstallationId: INSTALLATION_ROW,
        githubRepoId: 555,
        // Deliberately stale: the repository was renamed after connecting.
        repositoryUrl: "https://github.com/acme/old-name",
      }),
    ];

    const matched = matchApplications(apps, {
      repoUrl: "https://github.com/acme/new-name",
      branch: "main",
      installationRowId: INSTALLATION_ROW,
      repoId: 555,
    });

    expect(matched.map((a) => a.id)).toEqual(["connected"]);
  });

  it("never matches a connected app by URL alone", () => {
    // A repository webhook left over from the pre-App setup carries no
    // installation. If it could still match, the app would deploy twice.
    const apps = [
      candidate({
        id: "connected",
        githubInstallationId: INSTALLATION_ROW,
        githubRepoId: 555,
      }),
    ];

    expect(
      matchApplications(apps, { repoUrl: APP_URL, branch: "main" }),
    ).toEqual([]);
  });

  it("does not match a connected app from a different installation", () => {
    const apps = [
      candidate({
        githubInstallationId: INSTALLATION_ROW,
        githubRepoId: 555,
      }),
    ];

    expect(
      matchApplications(apps, {
        repoUrl: APP_URL,
        branch: "main",
        installationRowId: "bbbbbbbb-0000-0000-0000-000000000002",
        repoId: 555,
      }),
    ).toEqual([]);
  });

  it("does not match a connected app on a different repository", () => {
    const apps = [
      candidate({
        githubInstallationId: INSTALLATION_ROW,
        githubRepoId: 555,
      }),
    ];

    expect(
      matchApplications(apps, {
        repoUrl: APP_URL,
        branch: "main",
        installationRowId: INSTALLATION_ROW,
        repoId: 999,
      }),
    ).toEqual([]);
  });

  it("matches connected and unconnected apps side by side", () => {
    const apps = [
      candidate({ id: "legacy" }),
      candidate({
        id: "connected",
        githubInstallationId: INSTALLATION_ROW,
        githubRepoId: 555,
      }),
      candidate({ id: "elsewhere", repositoryUrl: "https://github.com/x/y" }),
    ];

    const matched = matchApplications(apps, {
      repoUrl: APP_URL,
      branch: "main",
      installationRowId: INSTALLATION_ROW,
      repoId: 555,
    });

    expect(matched.map((a) => a.id).sort()).toEqual(["connected", "legacy"]);
  });

  it("still matches a connected app when asked for URL-only matching", () => {
    // The generic endpoint is an explicit, per-app authenticated trigger, not
    // a GitHub delivery: nothing can double up, so refusing to match a
    // connected app there would just break a working CI integration.
    const apps = [
      candidate({
        id: "connected",
        githubInstallationId: INSTALLATION_ROW,
        githubRepoId: 555,
      }),
    ];

    expect(
      matchApplications(apps, {
        repoUrl: APP_URL,
        branch: "main",
        byUrlOnly: true,
      }).map((a) => a.id),
    ).toEqual(["connected"]);
  });

  it("ignores an app with no repository URL and no connection", () => {
    expect(
      matchApplications([candidate({ repositoryUrl: null })], {
        repoUrl: APP_URL,
        branch: "main",
      }),
    ).toEqual([]);
  });
});
