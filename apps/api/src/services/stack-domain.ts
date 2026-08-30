import { randomBytes } from "crypto";
import { isIPv4 } from "net";
import { eq } from "drizzle-orm";

import { db } from "../db/index";
import { servers } from "../db/schema/index";

/**
 * Picks the hostname a template's `${domain}` resolves to.
 *
 * A one-click template is not one-click if it first demands a DNS record, so
 * when the user gives no domain we synthesize one. In order of preference:
 *
 *   1. `TEMPLATES_BASE_DOMAIN` — a wildcard domain the operator points at this
 *      host. The only option that can carry a real Let's Encrypt certificate.
 *   2. sslip.io against the target server's IP. Resolves without any DNS setup
 *      (sslip.io answers `<anything>.1.2.3.4.sslip.io` with 1.2.3.4).
 *   3. Nothing — the caller is told to supply a domain, which beats deploying a
 *      stack nobody can reach.
 */

/** Short random suffix so two deployments of one template don't collide. */
const suffix = (): string => randomBytes(2).toString("hex");

/** Public address of the host stacks run on, when we can determine it. */
const resolveHostAddress = async (
  serverId?: string | null,
): Promise<string | null> => {
  if (serverId) {
    const server = await db.query.servers.findFirst({
      where: eq(servers.id, serverId),
      columns: { host: true, isLocal: true },
    });
    if (server && !server.isLocal && isIPv4(server.host)) return server.host;
  }

  // The local daemon's public address is not discoverable from inside the
  // container, so it has to be configured.
  const configured = process.env.PUBLIC_IP?.trim();
  return configured && isIPv4(configured) ? configured : null;
};

class DomainUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainUnavailableError";
  }
}

/**
 * @param stackName  used as the leftmost label, so the host is recognizable.
 * @throws DomainUnavailableError when no domain can be derived.
 */
const generateStackDomain = async (
  stackName: string,
  serverId?: string | null,
): Promise<string> => {
  const base = process.env.TEMPLATES_BASE_DOMAIN?.trim().replace(/^\.+/, "");
  if (base) return `${stackName}-${suffix()}.${base}`.toLowerCase();

  const address = await resolveHostAddress(serverId);
  if (address) {
    return `${stackName}-${suffix()}.${address}.sslip.io`.toLowerCase();
  }

  throw new DomainUnavailableError(
    "This template needs a domain, and DeployKit cannot derive one for this server. " +
      "Enter a domain, or set TEMPLATES_BASE_DOMAIN (a wildcard domain pointing here) " +
      "or PUBLIC_IP so one can be generated.",
  );
};

export { generateStackDomain, resolveHostAddress, DomainUnavailableError };
