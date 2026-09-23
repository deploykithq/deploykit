/**
 * Which env vars are secret.
 *
 * Env vars are stored as one encrypted blob with no per-key flag, so there is
 * nothing to look up: the split is a judgement made here. It is made in three
 * layers — the key's name, the value's shape, and the value's entropy —
 * because any single rule gets it wrong in one direction or the other.
 *
 * The two errors are not symmetric. A **false negative leaks a credential**
 * into a file meant for git. A **false positive costs nothing**: the value
 * simply travels in the secrets document instead of the committable one, and
 * an import restores it either way. So the name rule is deliberately broad.
 *
 * The one thing it must not do is withhold by the *name* `*_URL` / `*_URI` /
 * `*_HOST` / `*_ENDPOINT`. Those are the settings a manifest is most useful
 * for reviewing, and they are secret only when the value carries credentials —
 * which the value rules catch precisely.
 */

/** Layer 1: the name says so. */
const SECRET_KEY_PATTERN =
  /(PASS|PWD|SECRET|TOKEN|KEY|CRED|PRIVATE|SALT|SIGNING|CIPHER|DSN)/i;

/** Layer 2: the value is shaped like a credential, whatever it is called. */
const CREDENTIAL_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const JWT_PATTERN = /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./;
const TOKEN_PREFIX_PATTERN =
  /^(sk_|rk_|ghp_|gho_|ghu_|ghs_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|SG\.|dop_v1_|glpat-|npm_|hf_)/;

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Layer 3: long, unbroken and mixed-case-and-digits is what a generated
 * credential looks like. `generatePassword()` emits exactly this shape, so a
 * value that escaped the first two layers is still caught.
 */
const looksGenerated = (value: string): boolean => {
  if (value.length < 32) return false;
  if (/\s/.test(value)) return false;
  if (URL_PATTERN.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(value),
  ).length;
  return classes >= 3;
};

const isSecretEnvVar = (key: string, value: string): boolean => {
  if (SECRET_KEY_PATTERN.test(key)) return true;
  if (value.length === 0) return false;
  return (
    CREDENTIAL_URL_PATTERN.test(value) ||
    PRIVATE_KEY_PATTERN.test(value) ||
    JWT_PATTERN.test(value) ||
    TOKEN_PREFIX_PATTERN.test(value) ||
    looksGenerated(value)
  );
};

interface EnvSplitI {
  /** Safe to commit. */
  env: Record<string, string>;
  /** Withheld values, for the secrets document. */
  secrets: Record<string, string>;
  /** The withheld keys, sorted — what the config document advertises. */
  withheld: string[];
}

/**
 * Split env vars into the committable and the withheld half. Keys come out
 * sorted in both halves, so re-exporting an unchanged instance produces an
 * unchanged file — which is what makes the manifest reviewable in git.
 */
const splitEnvSecrets = (vars: Record<string, string>): EnvSplitI => {
  const env: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const key of Object.keys(vars).sort()) {
    const value = vars[key] ?? "";
    if (isSecretEnvVar(key, value)) secrets[key] = value;
    else env[key] = value;
  }
  return { env, secrets, withheld: Object.keys(secrets) };
};

export { isSecretEnvVar, splitEnvSecrets, type EnvSplitI };
