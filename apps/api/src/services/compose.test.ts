import { describe, it, expect } from "vitest";
import { parse } from "yaml";

import { ComposeFileError, transformCompose, listComposeServices } from "./compose";

const BASE = `
services:
  web:
    image: nginx:alpine
    expose:
      - "80"
    environment:
      HOST: \${WEB_HOST}
  db:
    image: postgres:16-alpine
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
`;

const opts = (overrides: Partial<Parameters<typeof transformCompose>[0]> = {}) => ({
  composeServiceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  stackName: "blog",
  composeFile: BASE,
  domains: [],
  ...overrides,
});

const routed = [
  {
    serviceName: "web",
    domain: "blog.example.com",
    port: 80,
    https: true,
    path: null,
    certificateResolver: "letsencrypt",
  },
];

describe("listComposeServices", () => {
  it("returns the service names declared in the file", () => {
    expect(listComposeServices(BASE).sort()).toEqual(["db", "web"]);
  });

  it("rejects a file with no services block", () => {
    expect(() => listComposeServices("volumes:\n  x:\n")).toThrow(
      ComposeFileError,
    );
  });

  it("rejects YAML that does not parse", () => {
    expect(() => listComposeServices("services:\n  - [unclosed\n")).toThrow(
      ComposeFileError,
    );
  });
});

describe("transformCompose — ownership labels", () => {
  it("labels every service so DeployKit can find the stack's containers", () => {
    const out = parse(transformCompose(opts()));

    for (const name of ["web", "db"]) {
      expect(out.services[name].labels).toMatchObject({
        "deploykit.managed": "true",
        "deploykit.project": "22222222-2222-4222-8222-222222222222",
        "deploykit.service": "11111111-1111-4111-8111-111111111111",
        "deploykit.compose.service": name,
      });
    }
  });

  it("preserves labels the blueprint already declared, in either syntax", () => {
    const withListLabels = `
services:
  web:
    image: nginx
    labels:
      - "com.example.keep=yes"
`;
    const out = parse(
      transformCompose(opts({ composeFile: withListLabels })),
    );
    expect(out.services.web.labels["com.example.keep"]).toBe("yes");
    expect(out.services.web.labels["deploykit.managed"]).toBe("true");
  });

  it("drops container_name, which collides with the Compose project prefix", () => {
    const named = `
services:
  web:
    image: nginx
    container_name: my-fixed-name
`;
    const out = parse(transformCompose(opts({ composeFile: named })));
    expect(out.services.web.container_name).toBeUndefined();
  });
});

describe("transformCompose — routing", () => {
  it("attaches Traefik labels and the shared network to routed services only", () => {
    const out = parse(transformCompose(opts({ domains: routed })));

    const web = out.services.web;
    expect(web.labels["traefik.enable"]).toBe("true");
    expect(web.labels["traefik.http.routers.dk-blog-web.rule"]).toBe(
      "Host(`blog.example.com`)",
    );
    expect(
      web.labels[
        "traefik.http.services.dk-blog-web.loadbalancer.server.port"
      ],
    ).toBe("80");
    expect(web.networks).toContain("deploykit-network");

    // The database is not routed: no Traefik labels, no shared network.
    expect(out.services.db.labels["traefik.enable"]).toBeUndefined();
    expect(out.services.db.networks).toBeUndefined();
  });

  it("keeps routed services on the project's default network", () => {
    // Naming any network detaches a service from the Compose default, which
    // would break service-name DNS to the rest of the stack (web -> db).
    const out = parse(transformCompose(opts({ domains: routed })));
    expect(out.services.web.networks).toContain("default");
  });

  it("declares the shared network as external", () => {
    const out = parse(transformCompose(opts({ domains: routed })));
    expect(out.networks["deploykit-network"]).toMatchObject({
      external: true,
    });
  });

  it("does not touch networks when nothing is routed", () => {
    const out = parse(transformCompose(opts()));
    expect(out.networks).toBeUndefined();
  });

  it("strips host port publishing from routed services", () => {
    // Traefik reaches the container over the shared network; a host port would
    // only create a collision between two stacks using the same one.
    const published = `
services:
  web:
    image: nginx
    ports:
      - "8080:80"
`;
    const out = parse(
      transformCompose(opts({ composeFile: published, domains: routed })),
    );
    expect(out.services.web.ports).toBeUndefined();
    expect(out.services.web.expose).toContain("80");
  });

  it("leaves host port publishing alone on unrouted services", () => {
    const published = `
services:
  web:
    image: nginx
    ports:
      - "8080:80"
`;
    const out = parse(transformCompose(opts({ composeFile: published })));
    expect(out.services.web.ports).toEqual(["8080:80"]);
  });

  it("rejects a domain pointing at a service the file does not define", () => {
    expect(() =>
      transformCompose(
        opts({ domains: [{ ...routed[0]!, serviceName: "nope" }] }),
      ),
    ).toThrow(ComposeFileError);
  });

  it("gives each routed service its own router name", () => {
    const two = parse(
      transformCompose(
        opts({
          domains: [
            ...routed,
            {
              serviceName: "db",
              domain: "db.example.com",
              port: 5432,
              https: false,
              path: null,
              certificateResolver: null,
            },
          ],
        }),
      ),
    );
    expect(two.services.web.labels["traefik.http.routers.dk-blog-web.rule"]).toBeDefined();
    expect(two.services.db.labels["traefik.http.routers.dk-blog-db.rule"]).toBeDefined();
  });
});

describe("transformCompose — interpolation is left to Compose", () => {
  it("does not resolve ${VAR}: that is Compose's job, fed by the .env file", () => {
    const out = transformCompose(opts());
    expect(out).toContain("${WEB_HOST}");
  });
});
