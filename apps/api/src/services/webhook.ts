import { createHmac, timingSafeEqual } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index";
import {
  applications,
  deployments,
  domains,
  githubApps,
  githubInstallations,
} from "../db/schema/index";
import type { ApplicationT } from "../db/schema/index";
import { deployQueue } from "../lib/redis";
import { decrypt } from "../lib/encryption";
import { getDockerForServer } from "./docker-factory";
import {
  getInstallationByGithubId,
  invalidateRepositoryCache,
} from "./github-app";
import { publishDeployStatus, upsertPreviewComment } from "./github-status";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

interface WebhookResult {
  triggered: boolean;
  applicationId?: string;
  deploymentId?: string;
  message: string;
  /** Signals the route should answer 401 instead of 200 */
  unauthorized?: boolean;
}

/** Per-app auth context for the generic webhook endpoint. */
interface GenericAuth {
  token: string | undefined;
  /** Whether the token already matched the global WEBHOOK_SECRET */
  globalOk: boolean;
}

/** What a GitHub App delivery adds to the identity of a repository. */
interface MatchContextExtraI {
  /** Local uuid of the github_installations row, when the App sent this. */
  installationRowId?: string;
  /** GitHub's numeric repository id. */
  repoId?: number;
}

interface MatchContextI extends MatchContextExtraI {
  repoUrl: string;
  branch: string;
  /**
   * Match every application by URL, connected or not.
   *
   * For the generic endpoint, which is an explicit, per-app authenticated
   * trigger rather than a GitHub delivery: there is no second delivery for it
   * to collide with, and refusing to match a connected app would silently
   * break a working CI integration.
   */
  byUrlOnly?: boolean;
}

/**
 * Pick the applications a delivery should deploy.
 *
 * Two disjoint rules, and the disjointness is the point:
 *
 *  - an app connected through the GitHub App matches on installation + repo
 *    id, which survives a rename or a transfer of the repository;
 *  - an app that is not connected matches on the normalized URL, exactly as
 *    before the App existed.
 *
 * A connected app is therefore never matched by URL. That is what stops a
 * repository webhook left over from the old setup deploying the same app a
 * second time — and a legacy delivery carries no installation, so it can only
 * ever take the second rule anyway.
 */
const matchApplications = <T extends Pick<ApplicationT, "id" | "repositoryUrl" | "githubInstallationId" | "githubRepoId">>(
  candidates: T[],
  ctx: MatchContextI,
): T[] => {
  const normalized = normalizeRepoUrl(ctx.repoUrl);

  return candidates.filter((app) => {
    if (app.githubInstallationId && !ctx.byUrlOnly) {
      return (
        !!ctx.installationRowId &&
        app.githubInstallationId === ctx.installationRowId &&
        !!ctx.repoId &&
        app.githubRepoId === ctx.repoId
      );
    }
    return (
      !!app.repositoryUrl &&
      normalizeRepoUrl(app.repositoryUrl) === normalized
    );
  });
};

/** Compare repository URLs ignoring case, a trailing slash and ".git". */
const normalizeRepoUrl = (url: string): string =>
  url
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();

const tokenMatches = (token: string, secret: string): boolean => {
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
};

export class WebhookService {
  /**
   * Verify an `x-hub-signature-256` over the raw request bytes.
   *
   * A delivery may be signed either by the registered GitHub App's own webhook
   * secret or — for repository webhooks configured by hand before the App
   * existed — by the instance-wide WEBHOOK_SECRET. Every candidate is compared
   * without short-circuiting and the results OR'd, so a legacy webhook keeps
   * working after an App is registered. No candidate at all stays fail-closed.
   */
  async verifyGitHubSignature(
    payload: Buffer,
    signature: string | undefined,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    const secrets = await this.githubSignatureSecrets(headers);
    if (secrets.length === 0) {
      console.error(
        "[webhook] No webhook secret configured — rejecting webhook. " +
          "Register a GitHub App, or set WEBHOOK_SECRET in your environment.",
      );
      return false;
    }
    if (!signature) return false;
    const given = Buffer.from(signature);
    let ok = false;
    for (const secret of secrets) {
      const expected = Buffer.from(
        "sha256=" + createHmac("sha256", secret).update(payload).digest("hex"),
      );
      try {
        // No early exit: every candidate is compared, so the work done does
        // not depend on which secret (if any) matched.
        if (timingSafeEqual(given, expected)) ok = true;
      } catch {
        // Length mismatch — a malformed signature header, not a match.
      }
    }
    return ok;
  }

  /** Candidate secrets for a GitHub delivery, in no particular order. */
  private async githubSignatureSecrets(
    headers?: Record<string, string>,
  ): Promise<string[]> {
    const secrets: string[] = [];

    // An App delivery names the App it came from. Falling back to whatever App
    // is registered keeps a delivery working if GitHub ever omits the header;
    // either way the secret still has to match, so nothing is trusted here.
    const targetId = Number(headers?.["x-github-hook-installation-target-id"]);
    const app = Number.isFinite(targetId)
      ? await db.query.githubApps.findFirst({
          where: eq(githubApps.appId, targetId),
        })
      : await db.query.githubApps.findFirst();

    if (app) {
      try {
        secrets.push(decrypt(app.webhookSecret));
      } catch {
        console.error(
          "[webhook] Could not decrypt the GitHub App webhook secret — " +
            "has ENCRYPTION_KEY changed?",
        );
      }
    }

    // Repository webhooks configured by hand before the App existed.
    if (WEBHOOK_SECRET) secrets.push(WEBHOOK_SECRET);
    return secrets;
  }

  verifyGitLabToken(token: string | undefined): boolean {
    if (!WEBHOOK_SECRET) {
      console.error(
        "[webhook] WEBHOOK_SECRET not configured — rejecting webhook. " +
          "Set WEBHOOK_SECRET in your environment to enable webhook verification.",
      );
      return false;
    }
    if (!token) return false;
    try {
      return timingSafeEqual(Buffer.from(token), Buffer.from(WEBHOOK_SECRET));
    } catch {
      return false;
    }
  }

  async handleGitHub(
    payload: any,
    headers: Record<string, string>,
  ): Promise<WebhookResult> {
    const event = headers["x-github-event"];

    if (event === "push") {
      return this.handlePush(payload);
    }

    if (event === "pull_request") {
      return this.handleGitHubPR(payload);
    }

    if (event === "installation" || event === "installation_repositories") {
      return this.handleInstallation(event, payload);
    }

    // GitHub shows this response in its own UI when you test a webhook, so
    // answering it explicitly is worth the two lines.
    if (event === "ping") {
      return { triggered: false, message: "pong" };
    }

    return { triggered: false, message: `Ignored event: ${event}` };
  }

  /**
   * Keep `github_installations` in step with GitHub.
   *
   * Deleting an installation leaves its applications in place: the foreign key
   * is ON DELETE SET NULL, so they surface as disconnected rather than
   * disappearing along with an accidental uninstall.
   */
  private async handleInstallation(
    event: string,
    payload: any,
  ): Promise<WebhookResult> {
    const action = payload.action as string;
    const installationId = Number(payload.installation?.id);
    if (!Number.isFinite(installationId)) {
      return { triggered: false, message: "Missing installation id" };
    }

    if (event === "installation_repositories") {
      // The cached repository list for this installation is now wrong.
      await invalidateRepositoryCache(installationId);
      return {
        triggered: false,
        message: `Installation ${installationId} repositories ${action}`,
      };
    }

    if (action === "deleted") {
      await db
        .delete(githubInstallations)
        .where(eq(githubInstallations.installationId, installationId));
      await invalidateRepositoryCache(installationId);
      return {
        triggered: false,
        message: `Installation ${installationId} removed`,
      };
    }

    const app = await db.query.githubApps.findFirst();
    if (!app) {
      return { triggered: false, message: "No GitHub App configured" };
    }

    const account = payload.installation?.account;
    const values = {
      githubAppId: app.id,
      installationId,
      accountLogin: account?.login ?? "unknown",
      accountType: account?.type ?? null,
      accountId: account?.id ? Number(account.id) : null,
      repositorySelection: payload.installation?.repository_selection ?? null,
      suspendedAt: payload.installation?.suspended_at
        ? new Date(payload.installation.suspended_at)
        : null,
      updatedAt: new Date(),
    };

    await db
      .insert(githubInstallations)
      .values(values)
      .onConflictDoUpdate({
        target: [
          githubInstallations.githubAppId,
          githubInstallations.installationId,
        ],
        set: values,
      });
    await invalidateRepositoryCache(installationId);

    return {
      triggered: false,
      message: `Installation ${installationId} ${action}`,
    };
  }

  /**
   * Identify the delivery's installation and repository.
   *
   * Present only on App deliveries: a legacy repository webhook carries no
   * `installation`, which is what keeps the two matching paths apart.
   */
  private async githubContext(payload: any): Promise<MatchContextExtraI> {
    const installationId = Number(payload.installation?.id);
    if (!Number.isFinite(installationId)) return {};

    const installation = await getInstallationByGithubId(installationId);
    return {
      installationRowId: installation?.id,
      repoId: payload.repository?.id
        ? Number(payload.repository.id)
        : undefined,
    };
  }

  private async handlePush(payload: any): Promise<WebhookResult> {
    const ref = payload.ref as string;
    const branch = ref?.replace("refs/heads/", "");
    const repoUrl =
      payload.repository?.clone_url || payload.repository?.html_url;
    const commitHash = payload.head_commit?.id || "unknown";
    const commitMessage = payload.head_commit?.message || "";

    if (!branch || !repoUrl) {
      return { triggered: false, message: "Missing branch or repo URL" };
    }

    return this.triggerDeploy(
      { repoUrl, branch, ...(await this.githubContext(payload)) },
      commitHash,
      commitMessage,
    );
  }

  private async handleGitHubPR(payload: any): Promise<WebhookResult> {
    const action = payload.action as string;
    const pr = payload.pull_request;
    const prNumber = pr?.number as number;
    const branch = pr?.head?.ref as string;
    const repoUrl =
      payload.repository?.clone_url || payload.repository?.html_url;
    const commitHash = (pr?.head?.sha as string) || "unknown";
    const commitMessage = `PR #${prNumber}: ${pr?.title || ""}`;

    if (!["opened", "synchronize", "reopened", "closed"].includes(action)) {
      return { triggered: false, message: `Ignored PR action: ${action}` };
    }

    if (!prNumber || !branch || !repoUrl) {
      return { triggered: false, message: "Missing PR metadata" };
    }

    const parents = await this.findPreviewParents({
      repoUrl,
      branch,
      ...(await this.githubContext(payload)),
    });
    if (parents.length === 0) {
      return {
        triggered: false,
        message: "No apps with previews enabled for this repo",
      };
    }

    if (action === "closed") {
      for (const parent of parents) {
        await this.cleanupPreview(parent.id, prNumber);
      }
      return {
        triggered: false,
        message: `Cleaned up previews for PR #${prNumber}`,
      };
    }

    for (const parent of parents) {
      await this.upsertPreview(
        parent,
        prNumber,
        branch,
        commitHash,
        commitMessage,
      );
    }

    return {
      triggered: true,
      message: `Preview deploy triggered for PR #${prNumber} (${branch})`,
    };
  }

  async handleGitLab(payload: any): Promise<WebhookResult> {
    const event = payload.object_kind;

    if (event === "push") {
      const ref = payload.ref as string;
      const branch = ref?.replace("refs/heads/", "");
      const repoUrl =
        payload.repository?.git_http_url || payload.repository?.url;
      const commitHash = payload.checkout_sha || "unknown";
      const commitMessage = payload.commits?.[0]?.message || "";

      if (!branch || !repoUrl) {
        return { triggered: false, message: "Missing branch or repo URL" };
      }

      // GitLab has no App equivalent, so these always take the URL path.
      return this.triggerDeploy(
        { repoUrl, branch },
        commitHash,
        commitMessage,
      );
    }

    if (event === "merge_request") {
      return this.handleGitLabMR(payload);
    }

    return { triggered: false, message: `Ignored event: ${event}` };
  }

  private async handleGitLabMR(payload: any): Promise<WebhookResult> {
    const attrs = payload.object_attributes;
    const action = attrs?.action as string; // open, update, merge, close
    const mrNumber = attrs?.iid as number;
    const branch = attrs?.source_branch as string;
    const repoUrl = payload.repository?.git_http_url || payload.repository?.url;
    const commitHash = attrs?.last_commit?.id || "unknown";
    const commitMessage = `MR !${mrNumber}: ${attrs?.title || ""}`;

    if (
      !["open", "update", "reopen"].includes(action) &&
      action !== "merge" &&
      action !== "close"
    ) {
      return { triggered: false, message: `Ignored MR action: ${action}` };
    }

    if (!mrNumber || !branch || !repoUrl) {
      return { triggered: false, message: "Missing MR metadata" };
    }

    const parents = await this.findPreviewParents({ repoUrl, branch });
    if (parents.length === 0) {
      return {
        triggered: false,
        message: "No apps with previews enabled for this repo",
      };
    }

    if (action === "merge" || action === "close") {
      for (const parent of parents) {
        await this.cleanupPreview(parent.id, mrNumber);
      }
      return {
        triggered: false,
        message: `Cleaned up previews for MR !${mrNumber}`,
      };
    }

    for (const parent of parents) {
      await this.upsertPreview(
        parent,
        mrNumber,
        branch,
        commitHash,
        commitMessage,
      );
    }

    return {
      triggered: true,
      message: `Preview deploy triggered for MR !${mrNumber} (${branch})`,
    };
  }

  async handleGeneric(
    payload: any,
    token: string | undefined,
  ): Promise<WebhookResult> {
    const ref = payload.ref as string;
    const branch = ref?.replace("refs/heads/", "");
    const repoUrl =
      payload.repository?.clone_url ||
      payload.repository?.html_url ||
      payload.repository?.links?.html?.href;

    if (!branch || !repoUrl) {
      return {
        triggered: false,
        message: "Could not extract branch/repo from payload",
      };
    }

    const commitHash =
      payload.head_commit?.id || payload.after || "unknown";
    const commitMessage =
      payload.head_commit?.message || payload.commits?.[0]?.message || "";

    const globalOk =
      !!token && !!WEBHOOK_SECRET && tokenMatches(token, WEBHOOK_SECRET);

    return this.triggerDeploy(
      { repoUrl, branch, byUrlOnly: true },
      commitHash,
      commitMessage,
      { token, globalOk },
    );
  }

  private async triggerDeploy(
    ctx: MatchContextI,
    commitHash: string,
    commitMessage: string,
    auth?: GenericAuth,
  ): Promise<WebhookResult> {
    const { repoUrl, branch } = ctx;

    // Only match non-preview apps (previews are managed separately)
    const allApps = await db.query.applications.findMany({
      where: and(
        eq(applications.branch, branch),
        eq(applications.isPreview, false),
      ),
    });

    let matchingApps = matchApplications(allApps, ctx);

    // Generic endpoint: every deploy must be authorized either by the app's
    // own webhook secret or by the global WEBHOOK_SECRET
    if (auth) {
      matchingApps = matchingApps.filter((app) => {
        if (app.webhookSecret) {
          if (!auth.token) return false;
          try {
            return tokenMatches(auth.token, decrypt(app.webhookSecret));
          } catch {
            return false;
          }
        }
        return auth.globalOk;
      });
      // Without a valid global token, never reveal whether the repo/branch
      // matched anything — callers could enumerate configured apps otherwise
      if (matchingApps.length === 0 && !auth.globalOk) {
        return {
          triggered: false,
          unauthorized: true,
          message: "Invalid or missing webhook token",
        };
      }
    }

    if (matchingApps.length === 0) {
      return {
        triggered: false,
        message: `No applications found for ${normalizeRepoUrl(repoUrl)} (branch: ${branch})`,
      };
    }

    for (const app of matchingApps) {
      const [deployment] = await db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "queued",
          commitHash,
          commitMessage,
        })
        .returning();

      await db
        .update(applications)
        .set({ status: "building", updatedAt: new Date() })
        .where(eq(applications.id, app.id));

      await deployQueue.add(
        "deploy",
        {
          deploymentId: deployment!.id,
          applicationId: app.id,
        },
        { jobId: deployment!.id },
      );

      // Mark the commit as pending the moment it is queued, not when the
      // worker picks it up: a deploy waiting behind another would otherwise
      // show nothing on the PR for as long as the queue is busy.
      void publishDeployStatus(deployment!.id, "pending", {
        description: "Queued",
      });

      console.log(
        `[webhook] Deploy triggered for "${app.name}" (${commitHash})`,
      );
    }

    const firstApp = matchingApps[0]!;
    return {
      triggered: true,
      applicationId: firstApp.id,
      message: `Triggered ${matchingApps.length} deployment(s) for branch "${branch}"`,
    };
  }

  /** Find parent apps that have preview deployments enabled for a given repo. */
  private async findPreviewParents(ctx: MatchContextI) {
    const all = await db.query.applications.findMany({
      where: and(
        eq(applications.previewEnabled, true),
        eq(applications.isPreview, false),
      ),
    });
    return matchApplications(all, ctx);
  }

  /** Create or update a preview app for a PR/MR, then queue a deployment. */
  private async upsertPreview(
    parent: typeof applications.$inferSelect,
    prNumber: number,
    branch: string,
    commitHash: string,
    commitMessage: string,
  ): Promise<void> {
    // Check if preview already exists for this PR
    const existing = await db.query.applications.findFirst({
      where: and(
        eq(applications.parentApplicationId, parent.id),
        eq(applications.previewPrNumber, prNumber),
        eq(applications.isPreview, true),
      ),
    });

    let previewId: string;

    if (existing) {
      // Update branch in case the PR head changed
      await db
        .update(applications)
        .set({ previewBranch: branch, branch, updatedAt: new Date() })
        .where(eq(applications.id, existing.id));
      previewId = existing.id;
      console.log(`[preview] Updating preview for PR #${prNumber} (${branch})`);
    } else {
      // Slug-safe app name: preview-{appname}-pr{number}
      const previewName = slugify(`${parent.name}-pr${prNumber}`);

      const [preview] = await db
        .insert(applications)
        .values({
          projectId: parent.projectId,
          name: previewName,
          sourceType: parent.sourceType,
          repositoryUrl: parent.repositoryUrl,
          branch,
          // Inherit the App connection rather than the credential: a preview
          // then stores no secret at all. Only a parent still on a pasted
          // token has anything to copy.
          githubInstallationId: parent.githubInstallationId,
          githubRepoId: parent.githubRepoId,
          githubRepoFullName: parent.githubRepoFullName,
          commitStatusEnabled: parent.commitStatusEnabled,
          sourceToken: parent.githubInstallationId
            ? null
            : parent.sourceToken, // encrypted — copied as-is
          rootDirectory: parent.rootDirectory,
          buildType: parent.buildType,
          dockerfilePath: parent.dockerfilePath,
          envVars: parent.envVars, // encrypted — copied as-is
          port: parent.port,
          serverId: parent.serverId,
          healthCheckType: parent.healthCheckType,
          healthCheckPath: parent.healthCheckPath,
          healthCheckTimeout: parent.healthCheckTimeout,
          healthCheckInterval: parent.healthCheckInterval,
          healthCheckRetries: parent.healthCheckRetries,
          isPreview: true,
          parentApplicationId: parent.id,
          previewPrNumber: prNumber,
          previewBranch: branch,
        })
        .returning();

      previewId = preview!.id;

      // Add subdomain via Traefik if the parent has a previewDomain configured
      if (parent.previewDomain) {
        const subdomain = `pr-${prNumber}.${parent.previewDomain}`;
        await db.insert(domains).values({
          applicationId: previewId,
          domain: subdomain,
          port: parent.port || 3000,
          https: false, // HTTP by default; wildcard HTTPS needs DNS challenge
        });
      }

      console.log(
        `[preview] Created preview "${previewName}" for PR #${prNumber}`,
      );
    }

    // Queue deployment
    const [deployment] = await db
      .insert(deployments)
      .values({
        applicationId: previewId,
        status: "queued",
        commitHash,
        commitMessage,
      })
      .returning();

    await db
      .update(applications)
      .set({ status: "building", updatedAt: new Date() })
      .where(eq(applications.id, previewId));

    await deployQueue.add(
      "deploy",
      {
        deploymentId: deployment!.id,
        applicationId: previewId,
      },
      { jobId: deployment!.id },
    );

    void publishDeployStatus(deployment!.id, "pending", {
      description: "Building preview",
    });
    void upsertPreviewComment(previewId, "deploying", commitHash);
  }

  /** Stop container and delete the preview app record on PR close/merge. */
  private async cleanupPreview(
    parentId: string,
    prNumber: number,
  ): Promise<void> {
    const preview = await db.query.applications.findFirst({
      where: and(
        eq(applications.parentApplicationId, parentId),
        eq(applications.previewPrNumber, prNumber),
        eq(applications.isPreview, true),
      ),
    });

    if (!preview) return;

    // Edit the comment before the row goes: once it is deleted there is no
    // way back to the PR. Editing rather than deleting keeps the trail.
    await upsertPreviewComment(preview.id, "removed");

    if (preview.containerId) {
      try {
        const { docker } = await getDockerForServer(preview.serverId);
        await docker.stopAndRemove(preview.containerId);
      } catch {
        // Container may already be gone
      }
    }

    await db.delete(applications).where(eq(applications.id, preview.id));
    console.log(`[preview] Cleaned up preview for PR #${prNumber}`);
  }

  private normalizeUrl(url: string): string {
    return normalizeRepoUrl(url);
  }
}

/** Convert a string to a safe Docker container name slug. */
const slugify = (str: string): string => {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60); // Docker name limit
};

export { matchApplications, normalizeRepoUrl, type MatchContextI };
