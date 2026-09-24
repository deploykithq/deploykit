import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createPrivateKey } from "crypto";

import { githubApps, githubInstallations } from "../db/schema/index";
import type { GithubAppT, GithubInstallationT } from "../db/schema/index";

import { router, protectedProcedure, adminProcedure } from "../trpc";

import { encrypt } from "../lib/encryption";
import { logAction } from "../lib/audit/audit";
import { getProjectRole, canOperate } from "../lib/permissions";

import {
  getGitHubApp,
  invalidateGitHubApp,
  appAuth,
  getInstallationById,
  listInstallationRepositories,
  listRepositoryBranches,
} from "../services/github-app";
import { ghRequest, GitHubApiError } from "../services/github-client";
import {
  manifestUrls,
  assertWebhookReachable,
  buildManifest,
  manifestPostUrl,
  issueManifestState,
  consumeManifestState,
  convertManifestCode,
  installUrl,
} from "../services/github-manifest";

/** Turn any GitHub-side failure into a tRPC error without leaking internals. */
const asTrpcError = (err: unknown, fallback: string): TRPCError => {
  if (err instanceof GitHubApiError) {
    return new TRPCError({
      code: err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
      message: `GitHub: ${err.message}`,
    });
  }
  return new TRPCError({
    code: "BAD_REQUEST",
    message: (err as Error)?.message || fallback,
  });
};

/** The App row as the UI may see it: identity yes, key material never. */
const toPublicApp = (app: GithubAppT) => ({
  id: app.id,
  appId: app.appId,
  slug: app.slug,
  name: app.name,
  ownerLogin: app.ownerLogin,
  htmlUrl: app.htmlUrl,
  apiBaseUrl: app.apiBaseUrl,
  webBaseUrl: app.webBaseUrl,
  createdAt: app.createdAt,
  hasClientSecret: !!app.clientSecret,
});

const toPublicInstallation = (row: GithubInstallationT) => ({
  id: row.id,
  installationId: row.installationId,
  accountLogin: row.accountLogin,
  accountType: row.accountType,
  repositorySelection: row.repositorySelection,
  suspended: !!row.suspendedAt,
  // Where an admin goes to add or remove repositories for this installation.
  settingsUrl: `https://github.com/settings/installations/${row.installationId}`,
});

/** Load the App or fail with a message that says what to do about it. */
const requireApp = async (): Promise<GithubAppT> => {
  const app = await getGitHubApp();
  if (!app) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No GitHub App is configured. Register one in Settings first.",
    });
  }
  return app;
};

/** Upsert one installation from GitHub's representation of it. */
const upsertInstallation = async (
  ctx: any,
  appRowId: string,
  data: any,
): Promise<GithubInstallationT> => {
  const values = {
    githubAppId: appRowId,
    installationId: Number(data.id),
    accountLogin: data.account?.login ?? "unknown",
    accountType: data.account?.type ?? null,
    accountId: data.account?.id ? Number(data.account.id) : null,
    repositorySelection: data.repository_selection ?? null,
    suspendedAt: data.suspended_at ? new Date(data.suspended_at) : null,
    updatedAt: new Date(),
  };

  const [row] = await ctx.db
    .insert(githubInstallations)
    .values(values)
    .onConflictDoUpdate({
      target: [
        githubInstallations.githubAppId,
        githubInstallations.installationId,
      ],
      set: values,
    })
    .returning();
  return row!;
};

/**
 * Resolve an installation for a caller who is acting within a project.
 *
 * `protectedProcedure` only proves the caller is signed in, so the project role
 * is checked here: listing an organization's repositories is not something a
 * viewer of some unrelated project should be able to do.
 */
const requireProjectOperator = async (ctx: any, projectId: string) => {
  const role = await getProjectRole(ctx.user, projectId);
  if (!role) {
    // NOT_FOUND, not FORBIDDEN: non-members must not learn the id exists.
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  if (!canOperate(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Operator access is required",
    });
  }
};

const requireInstallation = async (
  id: string,
): Promise<GithubInstallationT> => {
  const installation = await getInstallationById(id);
  if (!installation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "GitHub App installation not found",
    });
  }
  return installation;
};

export const githubRouter = router({
  /**
   * Whether the instance has an App, for the forms that offer a repo picker.
   *
   * Every signed-in caller learns only that one exists — which is all the
   * application forms need. The App's identity and the accounts it is
   * installed on are administrative detail, so they go to admins only;
   * a project operator gets the accounts it may actually use from
   * `listInstallations`, which is scoped to a project.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const app = await getGitHubApp();
    const empty = {
      app: null,
      installUrl: null,
      installations: [] as ReturnType<typeof toPublicInstallation>[],
    };

    if (!app) return { configured: false, ...empty };
    if (ctx.user.role !== "admin") return { configured: true, ...empty };

    const installations = await ctx.db.query.githubInstallations.findMany({
      where: eq(githubInstallations.githubAppId, app.id),
      orderBy: (i: any, { asc }: any) => [asc(i.accountLogin)],
    });

    return {
      configured: true,
      app: toPublicApp(app),
      installUrl: installUrl(app.webBaseUrl, app.slug),
      installations: installations.map(toPublicInstallation),
    };
  }),

  /** The manifest and the URL to POST it to. Nothing is created yet. */
  startManifest: adminProcedure
    .input(
      z.object({
        organization: z.string().max(100).optional(),
        name: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getGitHubApp();
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A GitHub App is already configured. Disconnect it before registering another.",
        });
      }

      let urls;
      try {
        urls = manifestUrls();
        assertWebhookReachable(urls);
      } catch (err) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: (err as Error).message,
        });
      }

      const state = await issueManifestState(ctx.user.id);
      return {
        postUrl: manifestPostUrl(state, input.organization),
        manifest: JSON.stringify(buildManifest(urls, input.name)),
        webhookUrl: urls.webhookUrl,
        redirectUrl: urls.redirectUrl,
      };
    }),

  /** Exchange GitHub's one-time code for the App's credentials and store them. */
  completeManifest: adminProcedure
    .input(z.object({ code: z.string().min(1).max(255), state: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await consumeManifestState(input.state, ctx.user.id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This registration link has expired or was already used. Start again from Settings.",
        });
      }

      let conversion;
      try {
        conversion = await convertManifestCode(input.code);
      } catch (err) {
        throw asTrpcError(err, "Could not complete the GitHub App registration");
      }

      const [row] = await ctx.db
        .insert(githubApps)
        .values({
          appId: conversion.appId,
          slug: conversion.slug,
          name: conversion.name,
          ownerLogin: conversion.ownerLogin ?? null,
          htmlUrl: conversion.htmlUrl ?? null,
          clientId: conversion.clientId ?? null,
          clientSecret: conversion.clientSecret
            ? encrypt(conversion.clientSecret)
            : null,
          privateKey: encrypt(conversion.pem),
          webhookSecret: encrypt(conversion.webhookSecret),
        })
        .returning();
      invalidateGitHubApp();

      await logAction(ctx, {
        action: "github_app.create",
        resourceType: "github_app",
        resourceId: row!.id,
        resourceName: row!.name,
        metadata: { appId: row!.appId, via: "manifest" },
      });

      return {
        app: toPublicApp(row!),
        installUrl: installUrl(row!.webBaseUrl, row!.slug),
      };
    }),

  /**
   * Connect an App that already exists, for admins who created one by hand.
   *
   * The credentials are proved rather than trusted: we sign a JWT with the
   * given key and call `GET /app`, which both validates the pair and tells us
   * the App's identity, so none of it has to be typed in.
   */
  connectExisting: adminProcedure
    .input(
      z.object({
        appId: z.number().int().positive(),
        privateKey: z.string().min(100).max(10_000),
        webhookSecret: z.string().min(1).max(255),
        clientId: z.string().max(100).optional(),
        clientSecret: z.string().max(255).optional(),
        apiBaseUrl: z.string().url().max(255).optional(),
        webBaseUrl: z.string().url().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getGitHubApp();
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A GitHub App is already configured. Disconnect it before connecting another.",
        });
      }

      const pem = input.privateKey.replace(/\r\n/g, "\n").trim();
      try {
        createPrivateKey(pem);
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That does not look like a PEM private key. Paste the whole .pem file GitHub gave you, including its BEGIN and END lines.",
        });
      }

      const candidate = {
        appId: input.appId,
        privateKey: encrypt(pem),
        apiBaseUrl: input.apiBaseUrl ?? "https://api.github.com",
      } as GithubAppT;

      let identity: any;
      try {
        const res = await ghRequest<any>("/app", {
          auth: appAuth(candidate),
          baseUrl: candidate.apiBaseUrl,
        });
        identity = res.data;
      } catch (err) {
        throw asTrpcError(
          err,
          "GitHub rejected those credentials. Check the App ID and private key.",
        );
      }

      const [row] = await ctx.db
        .insert(githubApps)
        .values({
          appId: input.appId,
          slug: identity.slug,
          name: identity.name,
          ownerLogin: identity.owner?.login ?? null,
          htmlUrl: identity.html_url ?? null,
          clientId: input.clientId ?? null,
          clientSecret: input.clientSecret
            ? encrypt(input.clientSecret)
            : null,
          privateKey: encrypt(pem),
          webhookSecret: encrypt(input.webhookSecret),
          ...(input.apiBaseUrl && { apiBaseUrl: input.apiBaseUrl }),
          ...(input.webBaseUrl && { webBaseUrl: input.webBaseUrl }),
        })
        .returning();
      invalidateGitHubApp();

      await logAction(ctx, {
        action: "github_app.create",
        resourceType: "github_app",
        resourceId: row!.id,
        resourceName: row!.name,
        metadata: { appId: row!.appId, via: "manual" },
      });

      return {
        app: toPublicApp(row!),
        installUrl: installUrl(row!.webBaseUrl, row!.slug),
      };
    }),

  /** Confirm the stored credentials still work, and show what they grant. */
  test: adminProcedure.mutation(async () => {
    const app = await requireApp();
    try {
      const { data } = await ghRequest<any>("/app", {
        auth: appAuth(app),
        baseUrl: app.apiBaseUrl,
      });
      return {
        ok: true as const,
        name: data.name as string,
        permissions: data.permissions as Record<string, string>,
        events: data.events as string[],
      };
    } catch (err) {
      throw asTrpcError(err, "GitHub did not accept the stored credentials");
    }
  }),

  /**
   * Record one installation, given the id GitHub redirected back with.
   *
   * A forged id is harmless: the App JWT only authenticates us as our own App,
   * so GitHub answers 404 for any installation that is not ours.
   */
  syncInstallation: adminProcedure
    .input(z.object({ installationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const app = await requireApp();
      try {
        const { data } = await ghRequest<any>(
          `/app/installations/${input.installationId}`,
          { auth: appAuth(app), baseUrl: app.apiBaseUrl },
        );
        const row = await upsertInstallation(ctx, app.id, data);
        return toPublicInstallation(row);
      } catch (err) {
        throw asTrpcError(err, "Could not read that installation");
      }
    }),

  /** Reconcile every installation, for when a webhook was missed. */
  syncInstallations: adminProcedure.mutation(async ({ ctx }) => {
    const app = await requireApp();
    let installations: any[];
    try {
      const { data } = await ghRequest<any[]>(
        "/app/installations?per_page=100",
        { auth: appAuth(app), baseUrl: app.apiBaseUrl },
      );
      installations = data;
    } catch (err) {
      throw asTrpcError(err, "Could not list installations");
    }

    const seen: number[] = [];
    for (const data of installations) {
      await upsertInstallation(ctx, app.id, data);
      seen.push(Number(data.id));
    }

    // Drop rows for installations that no longer exist. Applications keep
    // their row (the FK is ON DELETE SET NULL) and surface as disconnected.
    const stored = await ctx.db.query.githubInstallations.findMany({
      where: eq(githubInstallations.githubAppId, app.id),
    });
    let removed = 0;
    for (const row of stored) {
      if (seen.includes(row.installationId)) continue;
      await ctx.db
        .delete(githubInstallations)
        .where(eq(githubInstallations.id, row.id));
      removed++;
    }

    await logAction(ctx, {
      action: "github_app.sync",
      resourceType: "github_app",
      resourceId: app.id,
      resourceName: app.name,
      metadata: { found: seen.length, removed },
    });

    return { found: seen.length, removed };
  }),

  /** Forget the App. Requires confirmation once applications are affected. */
  disconnect: adminProcedure
    .input(z.object({ confirm: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const app = await requireApp();

      const linked = await ctx.db.query.applications.findMany({
        columns: { id: true, name: true },
        where: (a: any, { isNotNull }: any) =>
          isNotNull(a.githubInstallationId),
      });

      if (linked.length > 0 && !input.confirm) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `${linked.length} application(s) deploy through this App. ` +
            "Disconnecting leaves them without credentials until you set an " +
            "access token or reconnect. Confirm to continue.",
        });
      }

      await ctx.db.delete(githubApps).where(eq(githubApps.id, app.id));
      invalidateGitHubApp();

      await logAction(ctx, {
        action: "github_app.delete",
        resourceType: "github_app",
        resourceId: app.id,
        resourceName: app.name,
        metadata: { affectedApplications: linked.length },
      });

      return { affectedApplications: linked.length };
    }),

  /** Installations a project operator may pick a repository from. */
  listInstallations: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProjectOperator(ctx, input.projectId);

      const app = await getGitHubApp();
      if (!app) return [];

      const rows = await ctx.db.query.githubInstallations.findMany({
        where: eq(githubInstallations.githubAppId, app.id),
        orderBy: (i: any, { asc }: any) => [asc(i.accountLogin)],
      });
      return rows.map(toPublicInstallation);
    }),

  /** Repositories one installation can see. */
  listRepositories: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        installationId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectOperator(ctx, input.projectId);
      const installation = await requireInstallation(input.installationId);

      try {
        return await listInstallationRepositories(installation);
      } catch (err) {
        throw asTrpcError(err, "Could not list repositories");
      }
    }),

  /** Branches of one repository, for the branch picker. */
  listBranches: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        installationId: z.string().uuid(),
        repoFullName: z
          .string()
          .max(255)
          // Anchored: this goes straight into an API path.
          .regex(/^[\w.-]+\/[\w.-]+$/, "Expected owner/repo"),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectOperator(ctx, input.projectId);
      const installation = await requireInstallation(input.installationId);

      try {
        return await listRepositoryBranches(installation, input.repoFullName);
      } catch (err) {
        throw asTrpcError(err, "Could not list branches");
      }
    }),
});
