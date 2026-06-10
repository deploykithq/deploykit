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
