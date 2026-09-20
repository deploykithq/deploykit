import { describe, it, expect } from "vitest";

import { buildTraefikLabels } from "./traefik";

/**
 * These labels were previously duplicated inside DockerService.deployApp and
 * RemoteDockerService.deployApp. The expectations below are that original
 * output, so extracting it here cannot silently change how existing
 * applications are routed.
 */
describe("buildTraefikLabels", () => {
  it("produces the HTTPS label set applications already relied on", () => {
    expect(
      buildTraefikLabels("dk-blog", [
        { domain: "blog.example.com", https: true, port: 3000 },
      ]),
    ).toEqual({
      "traefik.enable": "true",
      "traefik.http.routers.dk-blog.rule": "Host(`blog.example.com`)",
      "traefik.http.services.dk-blog.loadbalancer.server.port": "3000",
      "traefik.http.routers.dk-blog.entrypoints": "websecure",
      "traefik.http.routers.dk-blog.tls.certresolver": "letsencrypt",
      "traefik.http.routers.dk-blog-http.rule": "Host(`blog.example.com`)",
      "traefik.http.routers.dk-blog-http.entrypoints": "web",
      "traefik.http.routers.dk-blog-http.middlewares": "dk-blog-redirect",
      "traefik.http.middlewares.dk-blog-redirect.redirectscheme.scheme":
        "https",
    });
  });

  it("emits a plain web router with no redirect when https is off", () => {
    const labels = buildTraefikLabels("dk-blog", [
      { domain: "blog.example.com", https: false, port: 3000 },
    ]);
    expect(labels["traefik.http.routers.dk-blog.entrypoints"]).toBe("web");
    expect(labels["traefik.http.routers.dk-blog.tls.certresolver"]).toBeUndefined();
    expect(labels["traefik.http.routers.dk-blog-http.rule"]).toBeUndefined();
  });

  it("suffixes extra domains so their routers stay distinct", () => {
    const labels = buildTraefikLabels("dk-blog", [
      { domain: "a.example.com", https: false, port: 80 },
      { domain: "b.example.com", https: false, port: 81 },
    ]);
    expect(labels["traefik.http.routers.dk-blog.rule"]).toBe(
      "Host(`a.example.com`)",
    );
    expect(labels["traefik.http.routers.dk-blog-1.rule"]).toBe(
      "Host(`b.example.com`)",
    );
  });

  it("adds a PathPrefix when a path is given", () => {
    const labels = buildTraefikLabels("dk-api", [
      { domain: "example.com", https: false, port: 80, path: "/api" },
    ]);
    expect(labels["traefik.http.routers.dk-api.rule"]).toBe(
      "Host(`example.com`) && PathPrefix(`/api`)",
    );
  });

  it("emits nothing at all when there are no domains", () => {
    // Not even traefik.enable: a container with no domain must stay invisible
    // to Traefik rather than register a router with no rule.
    expect(buildTraefikLabels("dk-blog", [])).toEqual({});
  });

  it("refuses a domain that could break out of the rule's backtick quoting", () => {
    expect(() =>
      buildTraefikLabels("dk-evil", [
        { domain: "a.com`) || Host(`victim.com", https: false, port: 80 },
      ]),
    ).toThrow(/Unsafe characters/);
  });
});
