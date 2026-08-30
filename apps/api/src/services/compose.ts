import { parse, stringify } from "yaml";

import { buildTraefikLabels, type TraefikDomainI } from "../lib/traefik";

/**
 * Turns a blueprint's Compose file into the one DeployKit actually runs.
 *
 * The user's YAML is never rewritten on disk — routing and ownership are
 * injected here, at deploy time, so editing a domain does not mean editing
 * someone's Compose file, and a stack can always be traced back to the source
 * that produced it.
 *
 * What this deliberately does NOT do is resolve `${VAR}`. Inside a Compose file
 * that syntax belongs to Compose, which interpolates it from the `.env` written
 * alongside. DeployKit's own `${helper}` syntax exists only in `template.json`
 * and is resolved long before anything reaches here.
 */

const SHARED_NETWORK = "deploykit-network";

class ComposeFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeFileError";
  }
}

interface ComposeRouteI extends TraefikDomainI {
  /** Key under `services:` that this domain routes to. */
  serviceName: string;
  domain: string;
  port: number;
}

interface TransformComposeOptsI {
  composeServiceId: string;
  projectId: string;
  /** Stack name; also the Compose project name (`dk-<stackName>`). */
  stackName: string;
  composeFile: string;
  domains: ComposeRouteI[];
}

interface ComposeDocI {
  services: Record<string, Record<string, any>>;
  networks?: Record<string, any>;
  [key: string]: unknown;
}

const parseCompose = (composeFile: string): ComposeDocI => {
  let doc: unknown;
  try {
    doc = parse(composeFile);
  } catch (err: any) {
    throw new ComposeFileError(`Invalid YAML: ${err?.message ?? err}`);
  }

  if (!doc || typeof doc !== "object") {
    throw new ComposeFileError("Compose file is empty");
  }

  const services = (doc as ComposeDocI).services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new ComposeFileError(
      "Compose file has no `services:` block — nothing to deploy",
    );
  }
  if (Object.keys(services).length === 0) {
    throw new ComposeFileError("Compose file declares no services");
  }

  return doc as ComposeDocI;
};

/** Service names declared by a Compose file. Used to validate domain targets. */
const listComposeServices = (composeFile: string): string[] =>
  Object.keys(parseCompose(composeFile).services);

/**
 * Compose accepts labels as a map or as a `"key=value"` sequence. Normalize to
 * a map so injected labels merge instead of duplicating a key in two syntaxes.
 */
const normalizeLabels = (raw: unknown): Record<string, string> => {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const eq = entry.indexOf("=");
      if (eq === -1) out[entry] = "";
      else out[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return out;
  }
  if (typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ]),
    );
  }
  return {};
};

/** Container port from a `ports:` entry, so a stripped mapping still gets exposed. */
const containerPortOf = (entry: unknown): string | null => {
  if (typeof entry === "number") return String(entry);
  if (typeof entry === "object" && entry !== null) {
    const target = (entry as Record<string, unknown>).target;
    return target === undefined ? null : String(target);
  }
  if (typeof entry !== "string") return null;

  // "8080:80", "127.0.0.1:8080:80", "80", "8080:80/tcp"
  const [spec] = entry.split("/");
  const parts = spec!.split(":");
  return parts[parts.length - 1] || null;
};

/**
 * Merge a value into a service's `networks`, which Compose accepts as either a
 * list or a map. Returns the merged form, preserving whichever the author used.
 */
const withNetwork = (raw: unknown, network: string): unknown => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const map = raw as Record<string, unknown>;
    return network in map ? map : { ...map, [network]: null };
  }

  const list = Array.isArray(raw) ? raw.map(String) : [];
  // Naming any network detaches the service from the Compose default network,
  // which is how the rest of the stack resolves it by service name. Put it back.
  const merged = list.length > 0 ? [...list] : ["default"];
  if (!merged.includes(network)) merged.push(network);
  return merged;
};

/**
 * @returns the Compose file to hand to `docker compose`, with ownership labels
 *          on every service and Traefik routing on the ones that have a domain.
 */
const transformCompose = (opts: TransformComposeOptsI): string => {
  const doc = parseCompose(opts.composeFile);
  const serviceNames = new Set(Object.keys(doc.services));

  for (const route of opts.domains) {
    if (!serviceNames.has(route.serviceName)) {
      throw new ComposeFileError(
        `Domain "${route.domain}" routes to service "${route.serviceName}", ` +
          `which this Compose file does not define. Available: ${[...serviceNames].join(", ")}`,
      );
    }
  }

  // Several domains may target the same service — one router each.
  const routesByService = new Map<string, ComposeRouteI[]>();
  for (const route of opts.domains) {
    const existing = routesByService.get(route.serviceName) ?? [];
    existing.push(route);
    routesByService.set(route.serviceName, existing);
  }

  for (const [name, rawService] of Object.entries(doc.services)) {
    const service: Record<string, any> = { ...rawService };

    // Compose derives container names from the project name; a fixed one would
    // collide the moment the same blueprint is deployed twice.
    delete service.container_name;

    const labels = {
      ...normalizeLabels(service.labels),
      "deploykit.managed": "true",
      "deploykit.project": opts.projectId,
      "deploykit.service": opts.composeServiceId,
      "deploykit.compose.service": name,
    };

    const routes = routesByService.get(name);
    if (routes && routes.length > 0) {
      Object.assign(
        labels,
        buildTraefikLabels(`dk-${opts.stackName}-${name}`, routes),
      );
      service.networks = withNetwork(service.networks, SHARED_NETWORK);

      // Traefik reaches the container over the shared network, so publishing a
      // host port adds nothing and collides with any other stack using it.
      if (service.ports) {
        const exposed = new Set(
          (Array.isArray(service.expose) ? service.expose : []).map(String),
        );
        for (const entry of Array.isArray(service.ports) ? service.ports : []) {
          const port = containerPortOf(entry);
          if (port) exposed.add(port);
        }
        delete service.ports;
        if (exposed.size > 0) service.expose = [...exposed];
      }
    }

    service.labels = labels;
    doc.services[name] = service;
  }

  if (routesByService.size > 0) {
    doc.networks = {
      ...(doc.networks ?? {}),
      [SHARED_NETWORK]: { external: true, name: SHARED_NETWORK },
    };
  }

  return stringify(doc, { lineWidth: 0 });
};

export {
  ComposeFileError,
  SHARED_NETWORK,
  transformCompose,
  listComposeServices,
  type ComposeRouteI,
  type TransformComposeOptsI,
};
