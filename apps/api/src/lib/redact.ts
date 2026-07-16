const SECRET_PATTERNS: RegExp[] = [
  // Generic tokens: ghp_, glpat-, github_pat_, ghs_, sk-, sk_live_, sk_test_
  /\b(ghp_|glpat-|github_pat_|ghs_|sk-|sk_live_|sk_test_)[A-Za-z0-9_-]{10,}\b/g,
  // Bearer / Basic auth headers
  /(Bearer|Basic)\s+[A-Za-z0-9+/=_-]{20,}/gi,
  // x-access-token in URLs (git clone with token)
  /x-access-token:[^@\s]+@/gi,
  // Generic password= or secret= in key=value pairs
  /(password|secret|token|apikey|api_key|access_key|private_key)\s*[=:]\s*\S+/gi,
  // AWS keys
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  // Long hex strings that look like secrets (64+ chars)
  /\b[0-9a-f]{64,}\b/gi,
];

export const redactSecrets = (msg: string): string => {
  let redacted = msg;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (match) => {
      // Keep a short prefix for debugging context
      const prefix = match.slice(0, Math.min(6, match.length));
      return `${prefix}***REDACTED***`;
    });
  }
  return redacted;
}
