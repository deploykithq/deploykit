import { eq } from "drizzle-orm";

import { db } from "../db/index";
import { applications, deployments } from "../db/schema/index";
import type { ApplicationT } from "../db/schema/index";
import { shortSha } from "./git";
import {
  asInstallation,
  getInstallationById,
  resolveRepoFullName,
} from "./github-app";

/**
 * What DeployKit tells GitHub about a deploy.
 *
 * Commit statuses rather than check runs: a status needs only `statuses:write`,
 * is one request, is idempotent per (sha, context), and satisfies branch
 * protection just as well. A check run would additionally oblige us to handle
 * `check_run.rerequested`, or the "Re-run" button in GitHub's UI would sit
 * there doing nothing.
 *
 * Nothing in this module is allowed to fail a deploy. Every entry point
 * swallows its errors: GitHub being unreachable must never turn a deployment
 * that actually worked into a failed one.
 */

type StatusStateT = "pending" | "success" | "failure";
type PreviewPhaseT = "deploying" | "ready" | "failed" | "removed";

/** GitHub truncates past 140 characters, so do it ourselves and legibly. */
const MAX_DESCRIPTION = 140;

/** Marks our own comment so it can be found again if the id is ever lost. */
const COMMENT_MARKER = "<!-- deploykit:preview -->";

const truncate = (text: string): string =>
  text.length <= MAX_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;

const isFullSha = (hash: string | null | undefined): hash is string =>
  !!hash && /^[0-9a-f]{40}$/i.test(hash);

/** Base URL of the panel, for links GitHub shows to a human. */
const panelUrl = (): string | null => {
  const raw = process.env.WEB_URL;
  return raw ? raw.replace(/\/+$/, "") : null;
};

const deploymentUrl = (app: ApplicationT): string | undefined => {
  const base = panelUrl();
  return base
    ? `${base}/projects/${app.projectId}/apps/${app.id}`
    : undefined;
};

interface StatusTargetI {
  app: ApplicationT;
  /** The parent of a preview, or the app itself. */
  owner: ApplicationT;
  installationRowId: string;
  repoId: number;
}

/**
 * Work out what to publish against, or null when there is nothing to publish.
 *
 * A preview reports under its parent's name so that branch protection sees one
 * stable context per application rather than one per pull request.
 */
const resolveTarget = async (
  app: ApplicationT,
): Promise<StatusTargetI | null> => {
  if (!app.commitStatusEnabled) return null;

  let owner = app;
  if (app.isPreview && app.parentApplicationId) {
    const parent = await db.query.applications.findFirst({
      where: eq(applications.id, app.parentApplicationId),
    });
    if (parent) owner = parent;
  }

  const installationRowId = app.githubInstallationId ?? owner.githubInstallationId;
  const repoId = app.githubRepoId ?? owner.githubRepoId;
  if (!installationRowId || !repoId) return null;

  return { app, owner, installationRowId, repoId };
};

/** The repo an app's statuses and comments belong to, as `owner/repo`. */
const repoFullNameFor = async (
  target: StatusTargetI,
): Promise<{ fullName: string; installation: any } | null> => {
  const installation = await getInstallationById(target.installationRowId);
  if (!installation) return null;
  const fullName = await resolveRepoFullName(installation, target.repoId);
  return { fullName, installation };
};

/**
 * Publish a commit status for one deployment.
 *
 * Returns quietly when the deployment has nothing to report against: a Compose
 * stack (no application, no git), an application that is not connected to the
 * GitHub App, or a commit hash that is not a full SHA — GitHub's statuses API
 * rejects an abbreviated one.
 */
const publishDeployStatus = async (
  deploymentId: string,
  state: StatusStateT,
  opts: { description?: string; sha?: string } = {},
): Promise<void> => {
  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });
    if (!deployment?.applicationId) return;

    const sha = opts.sha ?? deployment.commitHash;
    if (!isFullSha(sha)) return;

    const app = await db.query.applications.findFirst({
      where: eq(applications.id, deployment.applicationId),
    });
    if (!app) return;

    const target = await resolveTarget(app);
    if (!target) return;

    const repo = await repoFullNameFor(target);
    if (!repo) return;

    const description =
      opts.description ??
      {
        pending: "Deploying...",
        success: "Deployed",
        failure: "Deploy failed",
      }[state];

    await asInstallation(
      repo.installation,
      `/repos/${repo.fullName}/statuses/${sha}`,
      {
        method: "POST",
        body: {
          state,
          context: `deploykit/${target.owner.name}`,
          description: truncate(description),
          target_url: deploymentUrl(app),
        },
      },
    );
  } catch (err: any) {
    console.warn(
      `[github] Could not publish ${state} status for deployment ${deploymentId}: ${err?.message || err}`,
    );
  }
};

/** The URL a preview is reachable at, honouring whether it got HTTPS. */
const previewUrl = async (appId: string): Promise<string | null> => {
  const domain = await db.query.domains.findFirst({
    where: (d, { eq: dEq }) => dEq(d.applicationId, appId),
  });
  if (!domain) return null;
  return `${domain.https ? "https" : "http"}://${domain.domain}`;
};

const commentBody = async (
  app: ApplicationT,
  phase: PreviewPhaseT,
  sha?: string | null,
): Promise<string> => {
  const url = phase === "ready" ? await previewUrl(app.id) : null;
  const logs = deploymentUrl(app);
  const commit = isFullSha(sha) ? ` (\`${shortSha(sha)}\`)` : "";

  const headline = {
    deploying: `**Deploying preview**${commit}...`,
    ready: url
      ? `**Preview ready**${commit} - ${url}`
      : `**Preview deployed**${commit}. No domain is configured for it.`,
    failed: `**Preview failed**${commit}.`,
    removed: "**Preview removed** - the pull request was closed.",
  }[phase];

  const footer =
    phase === "removed" || !logs ? "" : `\n\n[View deployment logs](${logs})`;

  return `${COMMENT_MARKER}\n### DeployKit\n\n${headline}${footer}`;
};

/**
 * Create or update this preview's single comment on its pull request.
 *
 * One comment that gets edited, not one per deploy: a long-lived PR should not
 * accumulate a wall of bot messages. The id is stored on the preview row; the
 * marker is the fallback for when it isn't (a restored database, or a comment
 * created before this ran).
 */
const upsertPreviewComment = async (
  previewId: string,
  phase: PreviewPhaseT,
  sha?: string | null,
): Promise<void> => {
  try {
    const app = await db.query.applications.findFirst({
      where: eq(applications.id, previewId),
    });
    if (!app?.isPreview || !app.previewPrNumber) return;

    const target = await resolveTarget(app);
    if (!target) return;

    const repo = await repoFullNameFor(target);
    if (!repo) return;

    const body = await commentBody(app, phase, sha);
    const base = `/repos/${repo.fullName}`;

    if (app.previewPrCommentId) {
      try {
        await asInstallation(
          repo.installation,
          `${base}/issues/comments/${app.previewPrCommentId}`,
          { method: "PATCH", body: { body } },
        );
        return;
      } catch (err: any) {
        // Someone deleted it; fall through and post a new one.
        if (err?.status !== 404) throw err;
      }
    }

    // Recover the id if we lost it but the comment is still there.
    const existing = await asInstallation<any[]>(
      repo.installation,
      `${base}/issues/${app.previewPrNumber}/comments?per_page=100`,
    );
    const mine = existing.find((c) => c?.body?.includes(COMMENT_MARKER));

    if (mine) {
      await asInstallation(
        repo.installation,
        `${base}/issues/comments/${mine.id}`,
        { method: "PATCH", body: { body } },
      );
      await db
        .update(applications)
        .set({ previewPrCommentId: Number(mine.id) })
        .where(eq(applications.id, previewId));
      return;
    }

    // Nothing to say on a preview that is already gone.
    if (phase === "removed") return;

    const created = await asInstallation<{ id: number }>(
      repo.installation,
      `${base}/issues/${app.previewPrNumber}/comments`,
      { method: "POST", body: { body } },
    );
    await db
      .update(applications)
      .set({ previewPrCommentId: Number(created.id) })
      .where(eq(applications.id, previewId));
  } catch (err: any) {
    console.warn(
      `[github] Could not update the preview comment for ${previewId}: ${err?.message || err}`,
    );
  }
};

/**
 * Report a finished deployment: commit status, plus the PR comment when the
 * application is a preview. Fire-and-forget at every call site.
 */
const reportDeployOutcome = async (
  deploymentId: string,
  applicationId: string,
  state: Exclude<StatusStateT, "pending">,
  opts: { description?: string; sha?: string } = {},
): Promise<void> => {
  await publishDeployStatus(deploymentId, state, opts);

  try {
    const app = await db.query.applications.findFirst({
      where: eq(applications.id, applicationId),
      columns: { id: true, isPreview: true },
    });
    if (app?.isPreview) {
      await upsertPreviewComment(
        applicationId,
        state === "success" ? "ready" : "failed",
        opts.sha,
      );
    }
  } catch {
    // Already non-fatal; upsertPreviewComment logs its own failures.
  }
};

export {
  publishDeployStatus,
  upsertPreviewComment,
  reportDeployOutcome,
  COMMENT_MARKER,
  truncate,
  isFullSha,
  type StatusStateT,
  type PreviewPhaseT,
};
