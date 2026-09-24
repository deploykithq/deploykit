import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The contract under test is mostly about when NOT to call GitHub, and about
 * never throwing, so the database and the API client are both stubbed and the
 * assertions are about what reached `asInstallation`.
 */

const FULL_SHA = "a".repeat(40);
const INSTALLATION_ROW = "11111111-1111-1111-1111-111111111111";

const state = {
  deployment: null as any,
  application: null as any,
  /** Consumed in order; the parent lookup is simply the next one. */
  applicationQueue: [] as any[],
  domain: null as any,
};

const updateCalls: any[] = [];

vi.mock("../db/index", () => ({
  db: {
    query: {
      deployments: { findFirst: async () => state.deployment },
      applications: {
        findFirst: async () =>
          state.applicationQueue.length > 0
            ? state.applicationQueue.shift()
            : state.application,
      },
      domains: { findFirst: async () => state.domain },
    },
    update: () => ({
      set: (values: any) => ({
        where: async () => {
          updateCalls.push(values);
        },
      }),
    }),
  },
}));

const asInstallation = vi.fn(async () => ({ id: 987 }) as any);
const getInstallationById = vi.fn(async (id: string) =>
  id === INSTALLATION_ROW ? { id, installationId: 42, accountLogin: "acme" } : null,
);
const resolveRepoFullName = vi.fn(async () => "acme/api");

vi.mock("./github-app", () => ({
  asInstallation: (...args: any[]) => asInstallation(...(args as [])),
  getInstallationById: (...args: any[]) =>
    getInstallationById(...(args as [any])),
  resolveRepoFullName: (...args: any[]) =>
    resolveRepoFullName(...(args as [])),
}));

const appRow = (over: Record<string, unknown> = {}) => ({
  id: "app-1",
  projectId: "proj-1",
  name: "api",
  commitStatusEnabled: true,
  githubInstallationId: INSTALLATION_ROW,
  githubRepoId: 555,
  isPreview: false,
  parentApplicationId: null,
  previewPrNumber: null,
  previewPrCommentId: null,
  ...over,
});

let mod: typeof import("./github-status");

beforeEach(async () => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  state.deployment = {
    id: "dep-1",
    applicationId: "app-1",
    commitHash: FULL_SHA,
  };
  state.application = appRow();
  state.applicationQueue = [];
  state.domain = null;
  process.env.WEB_URL = "https://deploy.acme.io";
  mod = await import("./github-status");
});

describe("truncate", () => {
  it("leaves a short description alone", () => {
    expect(mod.truncate("Deployed")).toBe("Deployed");
  });

  it("caps at GitHub's 140-character limit", () => {
    const out = mod.truncate("x".repeat(300));
    expect(out).toHaveLength(140);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("isFullSha", () => {
  it("accepts a 40-character hex SHA", () => {
    expect(mod.isFullSha(FULL_SHA)).toBe(true);
  });

  it("rejects the abbreviated and placeholder forms", () => {
    expect(mod.isFullSha("a".repeat(7))).toBe(false);
    expect(mod.isFullSha("latest")).toBe(false);
    expect(mod.isFullSha("unknown")).toBe(false);
    expect(mod.isFullSha(null)).toBe(false);
  });
});

describe("publishDeployStatus", () => {
  it("posts the status against the full SHA", async () => {
    await mod.publishDeployStatus("dep-1", "success");

    expect(asInstallation).toHaveBeenCalledTimes(1);
    const [, path, opts] = asInstallation.mock.calls[0] as any[];
    expect(path).toBe(`/repos/acme/api/statuses/${FULL_SHA}`);
    expect(opts.method).toBe("POST");
    expect(opts.body.state).toBe("success");
    expect(opts.body.context).toBe("deploykit/api");
    expect(opts.body.target_url).toBe(
      "https://deploy.acme.io/projects/proj-1/apps/app-1",
    );
  });

  it("truncates a long description before sending it", async () => {
    await mod.publishDeployStatus("dep-1", "failure", {
      description: "Deploy failed: " + "e".repeat(300),
    });
    const [, , opts] = asInstallation.mock.calls[0] as any[];
    expect(opts.body.description).toHaveLength(140);
  });

  it("reports a preview under its parent's context", async () => {
    // Branch protection evaluates a context by name, so every preview of an
    // application has to report under one stable name: the parent's.
    state.applicationQueue = [
      appRow({
        id: "preview-1",
        name: "api-pr7",
        isPreview: true,
        parentApplicationId: "parent-app",
      }),
      appRow({ id: "parent-app", name: "api" }),
    ];

    await mod.publishDeployStatus("dep-1", "pending");

    const [, , opts] = asInstallation.mock.calls[0] as any[];
    expect(opts.body.context).toBe("deploykit/api");
  });

  it("does nothing for a Compose stack deployment", async () => {
    // Stacks have no application and no git commit to report against.
    state.deployment = {
      id: "dep-1",
      applicationId: null,
      composeServiceId: "stack-1",
      commitHash: null,
    };
    await mod.publishDeployStatus("dep-1", "success");
    expect(asInstallation).not.toHaveBeenCalled();
  });

  it("does nothing when the application is not connected to the App", async () => {
    state.application = appRow({ githubInstallationId: null });
    await mod.publishDeployStatus("dep-1", "success");
    expect(asInstallation).not.toHaveBeenCalled();
  });

  it("does nothing when commit statuses are switched off", async () => {
    state.application = appRow({ commitStatusEnabled: false });
    await mod.publishDeployStatus("dep-1", "success");
    expect(asInstallation).not.toHaveBeenCalled();
  });

  it("does nothing without a full SHA", async () => {
    state.deployment = { id: "dep-1", applicationId: "app-1", commitHash: "latest" };
    await mod.publishDeployStatus("dep-1", "success");
    expect(asInstallation).not.toHaveBeenCalled();
  });

  it("does nothing when the installation row has vanished", async () => {
    state.application = appRow({ githubInstallationId: "gone" });
    await mod.publishDeployStatus("dep-1", "success");
    expect(asInstallation).not.toHaveBeenCalled();
  });

  it("swallows a GitHub failure instead of failing the deploy", async () => {
    // The whole point: a deployment that worked must not be reported as
    // failed because api.github.com was unreachable.
    asInstallation.mockRejectedValueOnce(new Error("network down"));
    await expect(
      mod.publishDeployStatus("dep-1", "success"),
    ).resolves.toBeUndefined();
  });
});

describe("upsertPreviewComment", () => {
  const preview = (over: Record<string, unknown> = {}) =>
    appRow({
      id: "preview-1",
      name: "api-pr7",
      isPreview: true,
      parentApplicationId: null,
      previewPrNumber: 7,
      ...over,
    });

  it("creates the comment the first time and remembers its id", async () => {
    state.application = preview();
    // No existing comment to recover.
    asInstallation.mockResolvedValueOnce([] as any);
    asInstallation.mockResolvedValueOnce({ id: 4242 } as any);

    await mod.upsertPreviewComment("preview-1", "deploying", FULL_SHA);

    const create = asInstallation.mock.calls.at(-1) as any[];
    expect(create[1]).toBe("/repos/acme/api/issues/7/comments");
    expect(create[2].method).toBe("POST");
    expect(create[2].body.body).toContain(mod.COMMENT_MARKER);
    expect(updateCalls).toContainEqual({ previewPrCommentId: 4242 });
  });

  it("edits the same comment on a later deploy instead of posting again", async () => {
    state.application = preview({ previewPrCommentId: 4242 });

    await mod.upsertPreviewComment("preview-1", "ready", FULL_SHA);

    expect(asInstallation).toHaveBeenCalledTimes(1);
    const [, path, opts] = asInstallation.mock.calls[0] as any[];
    expect(path).toBe("/repos/acme/api/issues/comments/4242");
    expect(opts.method).toBe("PATCH");
  });

  it("recovers a comment by its marker when the stored id is gone", async () => {
    state.application = preview();
    asInstallation.mockResolvedValueOnce([
      { id: 1, body: "unrelated chatter" },
      { id: 99, body: `${mod.COMMENT_MARKER}\nolder text` },
    ] as any);

    await mod.upsertPreviewComment("preview-1", "ready", FULL_SHA);

    const edit = asInstallation.mock.calls.at(-1) as any[];
    expect(edit[1]).toBe("/repos/acme/api/issues/comments/99");
    expect(edit[2].method).toBe("PATCH");
    expect(updateCalls).toContainEqual({ previewPrCommentId: 99 });
  });

  it("uses the preview's real scheme in the link", async () => {
    // upsertPreview creates preview domains with https disabled, so claiming
    // https:// in the comment would hand out a URL that does not work.
    state.application = preview({ previewPrCommentId: 4242 });
    state.domain = { domain: "pr-7.acme.io", https: false };

    await mod.upsertPreviewComment("preview-1", "ready", FULL_SHA);

    const [, , opts] = asInstallation.mock.calls[0] as any[];
    expect(opts.body.body).toContain("http://pr-7.acme.io");
    expect(opts.body.body).not.toContain("https://pr-7.acme.io");
  });

  it("does not create a comment for a preview that is already gone", async () => {
    state.application = preview();
    asInstallation.mockResolvedValueOnce([] as any);

    await mod.upsertPreviewComment("preview-1", "removed");

    // Only the lookup happened; nothing was posted.
    expect(asInstallation).toHaveBeenCalledTimes(1);
  });

  it("ignores an application that is not a preview", async () => {
    state.application = appRow();
    await mod.upsertPreviewComment("app-1", "ready");
    expect(asInstallation).not.toHaveBeenCalled();
  });

  it("swallows a GitHub failure", async () => {
    state.application = preview({ previewPrCommentId: 4242 });
    asInstallation.mockRejectedValueOnce(new Error("network down"));
    await expect(
      mod.upsertPreviewComment("preview-1", "ready"),
    ).resolves.toBeUndefined();
  });
});
