import { createHmac, timingSafeEqual } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index";
import { applications, deployments, domains } from "../db/schema/index";
import { deployQueue } from "../lib/redis";
import { decrypt } from "../lib/encryption";
import { getDockerForServer } from "./docker-factory";

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

const tokenMatches = (token: string, secret: string): boolean => {
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
};

export class WebhookService {
  verifyGitHubSignature(
    payload: string | Buffer,
    signature: string | undefined,
  ): boolean {
    if (!WEBHOOK_SECRET) {
      console.error(
        "[webhook] WEBHOOK_SECRET not configured — rejecting webhook. " +
          "Set WEBHOOK_SECRET in your environment to enable webhook verification.",
      );
      return false;
    }
    if (!signature) return false;
    const expected =
      "sha256=" +
      createHmac("sha256", WEBHOOK_SECRET)
        .update(typeof payload === "string" ? payload : payload)
        .digest("hex");
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
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

    return { triggered: false, message: `Ignored event: ${event}` };
  }

  private async handlePush(payload: any): Promise<WebhookResult> {
    const ref = payload.ref as string;
    const branch = ref?.replace("refs/heads/", "");
    const repoUrl =
      payload.repository?.clone_url || payload.repository?.html_url;
    const commitHash = payload.head_commit?.id?.slice(0, 7) || "unknown";
    const commitMessage = payload.head_commit?.message || "";

    if (!branch || !repoUrl) {
      return { triggered: false, message: "Missing branch or repo URL" };
    }

    return this.triggerDeploy(repoUrl, branch, commitHash, commitMessage);
  }

  private async handleGitHubPR(payload: any): Promise<WebhookResult> {
    const action = payload.action as string;
    const pr = payload.pull_request;
    const prNumber = pr?.number as number;
    const branch = pr?.head?.ref as string;
    const repoUrl =
      payload.repository?.clone_url || payload.repository?.html_url;
    const commitHash = (pr?.head?.sha as string)?.slice(0, 7) || "unknown";
    const commitMessage = `PR #${prNumber}: ${pr?.title || ""}`;

    if (!["opened", "synchronize", "reopened", "closed"].includes(action)) {
      return { triggered: false, message: `Ignored PR action: ${action}` };
    }

    if (!prNumber || !branch || !repoUrl) {
      return { triggered: false, message: "Missing PR metadata" };
    }

    const parents = await this.findPreviewParents(repoUrl);
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
      const commitHash = payload.checkout_sha?.slice(0, 7) || "unknown";
      const commitMessage = payload.commits?.[0]?.message || "";

      if (!branch || !repoUrl) {
        return { triggered: false, message: "Missing branch or repo URL" };
      }

      return this.triggerDeploy(repoUrl, branch, commitHash, commitMessage);
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
    const commitHash = attrs?.last_commit?.id?.slice(0, 7) || "unknown";
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

    const parents = await this.findPreviewParents(repoUrl);
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
      payload.head_commit?.id?.slice(0, 7) ||
      payload.after?.slice(0, 7) ||
      "unknown";
    const commitMessage =
      payload.head_commit?.message || payload.commits?.[0]?.message || "";

    const globalOk =
      !!token && !!WEBHOOK_SECRET && tokenMatches(token, WEBHOOK_SECRET);

    return this.triggerDeploy(repoUrl, branch, commitHash, commitMessage, {
      token,
      globalOk,
    });
  }

  private async triggerDeploy(
    repoUrl: string,
    branch: string,
    commitHash: string,
    commitMessage: string,
    auth?: GenericAuth,
  ): Promise<WebhookResult> {
    const normalizedUrl = this.normalizeUrl(repoUrl);

    // Only match non-preview apps (previews are managed separately)
    const allApps = await db.query.applications.findMany({
      where: and(
        eq(applications.branch, branch),
        eq(applications.isPreview, false),
      ),
    });

    let matchingApps = allApps.filter((app) => {
      if (!app.repositoryUrl) return false;
      return this.normalizeUrl(app.repositoryUrl) === normalizedUrl;
    });

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
        message: `No applications found for ${normalizedUrl} (branch: ${branch})`,
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
  private async findPreviewParents(repoUrl: string) {
    const normalizedUrl = this.normalizeUrl(repoUrl);
    const all = await db.query.applications.findMany({
      where: and(
        eq(applications.previewEnabled, true),
        eq(applications.isPreview, false),
      ),
    });
    return all.filter(
      (app) =>
        app.repositoryUrl &&
        this.normalizeUrl(app.repositoryUrl) === normalizedUrl,
    );
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
          sourceToken: parent.sourceToken, // encrypted — copied as-is
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
    return url
      .replace(/\.git$/, "")
      .replace(/\/$/, "")
      .toLowerCase();
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
