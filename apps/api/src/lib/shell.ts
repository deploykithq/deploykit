/**
 * Shell-escape a string for POSIX shells by wrapping in single quotes.
 * Handles embedded single quotes safely.
 */
const shellEscape = (str: string): string => "'" + str.replace(/'/g, "'\"'\"'") + "'";

/**
 * Only allow safe characters in shell arguments used without quoting.
 * Throws on anything outside [a-zA-Z0-9._-].
 */
const validateShellArg = (str: string): string => {
  if (!/^[a-zA-Z0-9._\-]+$/.test(str)) {
    throw new Error(`Unsafe shell argument: "${str}"`);
  }
  return str;
};

export { shellEscape, validateShellArg };
