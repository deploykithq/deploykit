/**
 * Validate security-critical environment variables at startup. In production
 * we fail fast on weak or placeholder secrets; in development we only warn so
 * the default .env keeps working.
 */
const PLACEHOLDER_RE = /change[-_]?me/i;

const required = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "ENCRYPTION_KEY",
] as const;

export const checkEnv = (): void => {
  const isProd = process.env.NODE_ENV === "production";
  const problems: string[] = [];

  for (const name of required) {
    const value = process.env[name];
    if (!value) {
      problems.push(`${name} is not set`);
      continue;
    }
    if (PLACEHOLDER_RE.test(value)) {
      problems.push(`${name} still contains a placeholder value`);
    }
    if (value.length < 32) {
      problems.push(`${name} is too short (need at least 32 characters)`);
    }
  }

  if (problems.length === 0) return;

  const message =
    "Insecure secret configuration:\n  - " + problems.join("\n  - ");

  if (isProd) {
    throw new Error(
      `${message}\nGenerate strong values with: openssl rand -base64 48`,
    );
  }
  console.warn(`[env] WARNING — ${message}`);
};

/**
 * Warn (don't fail) when Compose stacks cannot work on this host.
 *
 * Deliberately advisory: applications and databases are unaffected by a missing
 * Compose plugin, so refusing to boot over it would take down a working
 * instance for a feature the operator may not use. Checked at startup rather
 * than at deploy time so the problem surfaces before someone tries.
 */
export const checkComposeSupport = async (): Promise<void> => {
  const { localComposeRunner, composeRoot } = await import(
    "../services/compose-runner"
  );

  if (!(await localComposeRunner.available())) {
    console.warn(
      "[compose] `docker compose` is not available on this host — Compose stacks " +
        "cannot be deployed locally. Install the Compose plugin " +
        "(Alpine: docker-cli-compose, Debian: docker-compose-plugin).",
    );
    return;
  }

  const root = composeRoot();
  const { mkdir, access } = await import("fs/promises");
  try {
    await mkdir(root, { recursive: true });
    await access(root);
  } catch (err: any) {
    console.warn(
      `[compose] COMPOSE_ROOT (${root}) is not writable: ${err?.message ?? err}. ` +
        "Stacks with mounted config files will fail to deploy.",
    );
    return;
  }

  console.log(`[compose] Ready (stack directory: ${root})`);
};
