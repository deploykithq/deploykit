import { lookup } from "dns/promises";
import { isIP } from "net";

/** True for loopback, private, link-local, and other non-public ranges. */
const isBlockedAddress = (ip: string): boolean => {
  const v = ip.toLowerCase();

  // IPv6
  if (v.includes(":")) {
    if (v === "::1" || v === "::") return true; // loopback / unspecified
    if (v.startsWith("fe80")) return true; // link-local
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
    // IPv4-mapped IPv6 (::ffff:a.b.c.d)
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]!);
    return false;
  }

  const parts = v.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0 || a === 127) return true; // this-host / loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
};

/**
 * Validate that a user-supplied URL is a plain http(s) URL pointing at a
 * public address, to prevent SSRF against internal services (Redis,
 * Postgres, cloud metadata endpoints, etc.). Resolves DNS so hostnames
 * that map to private IPs are also rejected.
 *
 * Throws on any violation. Best-effort: pair with egress controls in prod.
 */
export const assertSafeUrl = async (raw: string): Promise<void> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }

  const host = url.hostname;

  // Literal IP in the host
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error("URL points to a non-public address");
    }
    return;
  }

  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("URL points to a non-public address");
  }

  // Resolve and check every returned address
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve URL host");
  }
  if (records.some((r) => isBlockedAddress(r.address))) {
    throw new Error("URL resolves to a non-public address");
  }
};

/** Non-throwing variant for synchronous Zod refinements (no DNS lookup). */
export const isLiterallyPublicUrl = (raw: string): boolean => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (isIP(host) && isBlockedAddress(host)) return false;
  return true;
};
