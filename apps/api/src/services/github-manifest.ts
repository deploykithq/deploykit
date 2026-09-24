import { randomBytes } from "crypto";

import { redis } from "../lib/redis";
import { isLiterallyPublicUrl } from "../lib/ssrf";
import { ghRequest } from "./github-client";

/**
 * GitHub App registration through the manifest flow.
 *
 * The admin never copies an App id or a private key: DeployKit POSTs a
 * manifest describing the App it wants, GitHub creates it and hands back the
 * credentials in one exchange. That is also why a self-hosted install owns its
 * own App rather than sharing a central one — the App's webhook has to be able
 * to reach this instance, which no third party can arrange.
 */

const STATE_TTL_SEC = 900;
const statePrefix = "gh:manifest:";

interface ManifestUrlsI {
  /** Where GitHub delivers every event for this App. */
  webhookUrl: string;
  /** Where GitHub sends the browser after creating, and after installing. */
  redirectUrl: string;
  baseUrl: string;
}

interface AppManifestI {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  setup_url: string;
  setup_on_update: boolean;
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
}

interface ManifestConversionI {
  appId: number;
  slug: string;
  name: string;
  ownerLogin?: string;
  htmlUrl?: string;
  pem: string;
  webhookSecret: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * The instance's public base URL.
 *
 * Read from WEB_URL and never from the request's Host header: the header is
 * attacker-controlled, and it ends up in the App's redirect_url, which is
 * exactly where you would want to point it if you were trying to intercept the
 * one-time code GitHub sends back.
 */
const publicBaseUrl = (): string => {
  const raw = process.env.WEB_URL;
  if (!raw) {
    throw new Error(
      "WEB_URL is not set. GitHub needs a public URL to deliver webhooks to " +
        "and to redirect back to, so set WEB_URL before registering an App.",
    );
  }
  return raw.replace(/\/+$/, "");
};

const manifestUrls = (): ManifestUrlsI => {
  const baseUrl = publicBaseUrl();
  return {
    baseUrl,
    webhookUrl: `${baseUrl}/api/webhooks/github`,
    redirectUrl: `${baseUrl}/settings/github/callback`,
  };
};

/**
 * Reject a base URL GitHub could never deliver to.
 *
 * Only the webhook URL has to be reachable from the internet — the redirect is
 * resolved by the admin's own browser, so localhost is fine there. Catching
 * this before registration matters because the manifest freezes both URLs into
 * the App, and changing them afterwards means editing the App on GitHub.
 */
const assertWebhookReachable = (urls: ManifestUrlsI): void => {
  if (!isLiterallyPublicUrl(urls.webhookUrl)) {
    throw new Error(
      `GitHub cannot reach ${urls.webhookUrl}. Point WEB_URL at this ` +
        "instance's public URL — or, for local development, at a tunnel " +
        "(cloudflared, ngrok) — and try again.",
    );
  }
};

/**
 * The App DeployKit asks GitHub to create.
 *
 * Permissions are the minimum each feature needs:
 *  - metadata:read      mandatory for every App; also what lists repositories
 *  - contents:read      clone private repositories with an installation token
 *  - statuses:write     publish the pending/success/failure commit status
 *  - pull_requests:write  post and edit the preview comment on a PR
 *
 * Nothing asks for `checks` (commit statuses are enough and cost one call),
 * `deployments`, `administration`, `workflows` or `issues`.
 */
const buildManifest = (urls: ManifestUrlsI, name?: string): AppManifestI => {
  const host = new URL(urls.baseUrl).hostname;
  return {
    // App names are globally unique on GitHub, so the host disambiguates.
    name: name?.trim() || `DeployKit - ${host}`,
    url: urls.baseUrl,
    hook_attributes: { url: urls.webhookUrl, active: true },
    redirect_url: urls.redirectUrl,
    setup_url: urls.redirectUrl,
    setup_on_update: false,
    public: false,
    default_permissions: {
      metadata: "read",
      contents: "read",
      statuses: "write",
      pull_requests: "write",
    },
    default_events: [
      "push",
      "pull_request",
      "installation",
      "installation_repositories",
    ],
  };
};

/** Where the browser POSTs the manifest: a personal account, or an org. */
const manifestPostUrl = (state: string, organization?: string): string => {
  const org = organization?.trim();
  const base = org
    ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : "https://github.com/settings/apps/new";
  return `${base}?state=${encodeURIComponent(state)}`;
};

/** Issue a single-use state token bound to the admin who started the flow. */
const issueManifestState = async (userId: string): Promise<string> => {
  const state = randomBytes(32).toString("base64url");
  await redis.set(
    `${statePrefix}${state}`,
    JSON.stringify({ userId }),
    "EX",
    STATE_TTL_SEC,
  );
  return state;
};

/**
 * Consume a state token, asserting it belongs to this admin.
 *
 * GETDEL so a replay of the callback URL cannot be used a second time.
 */
const consumeManifestState = async (
  state: string,
  userId: string,
): Promise<boolean> => {
  if (!state) return false;
  const raw = await redis.getdel(`${statePrefix}${state}`);
  if (!raw) return false;
  try {
    return JSON.parse(raw).userId === userId;
  } catch {
    return false;
  }
};

/**
 * Exchange the one-time code GitHub redirected with for the App's credentials.
 *
 * Unauthenticated by design: the code is the credential, it is single-use and
 * it expires within the hour.
 */
const convertManifestCode = async (
  code: string,
): Promise<ManifestConversionI> => {
  const { data } = await ghRequest<any>(
    `/app-manifests/${encodeURIComponent(code)}/conversions`,
    { method: "POST" },
  );

  return {
    appId: data.id,
    slug: data.slug,
    name: data.name,
    ownerLogin: data.owner?.login,
    htmlUrl: data.html_url,
    pem: data.pem,
    webhookSecret: data.webhook_secret,
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
};

/** Where an admin goes to install (or reconfigure) the App on an account. */
const installUrl = (webBaseUrl: string, slug: string): string =>
  `${webBaseUrl.replace(/\/+$/, "")}/apps/${slug}/installations/new`;

export {
  manifestUrls,
  assertWebhookReachable,
  buildManifest,
  manifestPostUrl,
  issueManifestState,
  consumeManifestState,
  convertManifestCode,
  installUrl,
  publicBaseUrl,
  type ManifestUrlsI,
  type AppManifestI,
  type ManifestConversionI,
};
