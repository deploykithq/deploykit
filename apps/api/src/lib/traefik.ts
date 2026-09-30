/**
 * Traefik router labels.
 *
 * Both deploy paths generate these — a single-container application and every
 * routed service of a Compose stack — so they live here rather than in either
 * Docker service. Two copies would drift, and a drifted redirect or entrypoint
 * is the kind of bug that only shows up in production TLS.
 */

interface TraefikDomainI {
  domain: string;
  https: boolean;
  port: number;
  /** Optional path prefix; without it the router matches the whole host. */
  path?: string | null;
  certificateResolver?: string | null;
}

const DEFAULT_CERT_RESOLVER = "letsencrypt";

/**
 * Traefik rules are backtick-quoted inside a label value, so a backtick in a
 * hostname would let it break out of the quoting and forge a rule. Domains are
 * FQDN-validated before they reach the database; this is the belt to that
 * braces, sitting at the one place the value is interpolated into a rule.
 */
const assertRuleSafe = (value: string, what: string): void => {
  if (/[`"'\{}$]/.test(value)) {
    throw new Error(`Unsafe characters in ${what}: ${value}`);
  }
};

/** A Traefik router name must be unique across the whole instance. */
const sanitizeRouterName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "router";

/**
 * Build the labels routing `domains` to a container.
 *
 * @param baseName  router name prefix — unique per service (e.g. `dk-blog` or
 *                  `dk-blog-web`). Extra domains get a numeric suffix.
 * @param opts.priority  explicit router priority. Unset, Traefik ranks by rule
 *                  length; the maintenance container sets a high one so it
 *                  wins over the app's own routers for the same host.
 */
const buildTraefikLabels = (
  baseName: string,
  domains: TraefikDomainI[],
  opts: { priority?: number } = {},
): Record<string, string> => {
  const labels: Record<string, string> = {};
  if (domains.length === 0) return labels;

  labels["traefik.enable"] = "true";

  domains.forEach((d, i) => {
    assertRuleSafe(d.domain, "domain");
    const router = `${sanitizeRouterName(baseName)}${i > 0 ? `-${i}` : ""}`;

    let rule = `Host(\`${d.domain}\`)`;
    if (d.path) {
      assertRuleSafe(d.path, "path");
      rule += ` && PathPrefix(\`${d.path}\`)`;
    }

    labels[`traefik.http.routers.${router}.rule`] = rule;
    labels[`traefik.http.services.${router}.loadbalancer.server.port`] = String(
      d.port,
    );
    // Each domain declares its own service, so with two or more of them
    // Traefik cannot pick one implicitly and drops every router of the
    // container ("cannot be linked automatically with multiple Services").
    labels[`traefik.http.routers.${router}.service`] = router;
    if (opts.priority !== undefined) {
      labels[`traefik.http.routers.${router}.priority`] = String(opts.priority);
    }

    if (d.https) {
      labels[`traefik.http.routers.${router}.entrypoints`] = "websecure";
      labels[`traefik.http.routers.${router}.tls.certresolver`] =
        d.certificateResolver || DEFAULT_CERT_RESOLVER;
      // Plain HTTP on the same rule, redirected — otherwise port 80 404s.
      labels[`traefik.http.routers.${router}-http.rule`] = rule;
      labels[`traefik.http.routers.${router}-http.entrypoints`] = "web";
      labels[`traefik.http.routers.${router}-http.service`] = router;
      labels[`traefik.http.routers.${router}-http.middlewares`] =
        `${router}-redirect`;
      if (opts.priority !== undefined) {
        labels[`traefik.http.routers.${router}-http.priority`] = String(
          opts.priority,
        );
      }
      labels[
        `traefik.http.middlewares.${router}-redirect.redirectscheme.scheme`
      ] = "https";
    } else {
      labels[`traefik.http.routers.${router}.entrypoints`] = "web";
    }
  });

  return labels;
};

export {
  buildTraefikLabels,
  sanitizeRouterName,
  DEFAULT_CERT_RESOLVER,
  type TraefikDomainI,
};
