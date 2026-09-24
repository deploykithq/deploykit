import { decrypt } from "../lib/encryption";
import { getInstallationById, getInstallationToken } from "./github-app";

/**
 * Resolve the credential a deploy should clone with.
 *
 * Two mechanisms coexist deliberately. A GitHub App installation mints a token
 * that expires in an hour and only reaches the repositories that installation
 * was granted; a pasted PAT is long-lived and as broad as whoever created it
 * made it. The App wins when an application has one, and the PAT stays for
 * GitLab, Gitea, self-hosted git and anyone who never registered an App.
 *
 * Mirrors `ssh-key-resolver.ts`: the secret is fetched at the moment of use and
 * never held anywhere the caller can forget about.
 */

interface SourceCredentialsI {
  token?: string;
  source: "github_app" | "pat" | "none";
}

interface CredentialAppI {
  name: string;
  sourceToken: string | null;
  githubInstallationId: string | null;
}

const resolveSourceCredentials = async (
  app: CredentialAppI,
): Promise<SourceCredentialsI> => {
  if (app.githubInstallationId) {
    try {
      const installation = await getInstallationById(app.githubInstallationId);
      if (!installation) {
        throw new Error("the installation is no longer registered");
      }
      return { token: await getInstallationToken(installation), source: "github_app" };
    } catch (err: any) {
      // A PAT left over from before the app was connected is a usable
      // fallback; without one there is nothing to clone with, and the message
      // has to say what the operator should do about it.
      if (!app.sourceToken) {
        throw new Error(
          `Could not get GitHub App credentials for "${app.name}": ` +
            `${err?.message || "unknown error"}. Reconnect the repository ` +
            `under Settings → GitHub, or set an access token on the application.`,
        );
      }
      console.warn(
        `[github] Installation token failed for "${app.name}" ` +
          `(${err?.message || "unknown error"}) — falling back to its access token.`,
      );
    }
  }

  if (app.sourceToken) {
    return { token: decrypt(app.sourceToken), source: "pat" };
  }

  return { source: "none" };
};

export { resolveSourceCredentials, type SourceCredentialsI };
