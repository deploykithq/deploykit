import { describe, it, expect } from "vitest";

import { buildOneOffSpec, OneOffNotDeployedError } from "./task-runner";

import type { ApplicationT, DatabaseT } from "../db/schema/index";

const RUN_ID = "22222222-2222-4222-8222-222222222222";

const app = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "blog",
  containerImage: "dk-blog:abc1234",
  volumes: ["blog-data:/data"],
  cpuLimit: 500,
  memoryLimit: 256,
  port: 3000,
} as unknown as ApplicationT;

const database = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "maindb",
  type: "postgresql",
  dbUser: "deploykit",
  databaseName: "app",
  internalPort: 5432,
} as unknown as DatabaseT;

describe("buildOneOffSpec — application", () => {
  const spec = buildOneOffSpec({
    kind: "application",
    runId: RUN_ID,
    command: "php artisan migrate --force && echo done",
    timeoutSeconds: 120,
    app,
    env: { APP_ENV: "production", DB_PASSWORD: "s3cret" },
  });

  it("runs the app's own image", () => {
    expect(spec.image).toBe("dk-blog:abc1234");
  });

  it("wraps the command in a shell so && and pipes work", () => {
    expect(spec.cmd).toEqual([
      "/bin/sh",
      "-lc",
      "php artisan migrate --force && echo done",
    ]);
  });

  it("passes env as KEY=VALUE entries for the Docker API, not the CLI", () => {
    expect(spec.env).toContain("APP_ENV=production");
    expect(spec.env).toContain("DB_PASSWORD=s3cret");
  });

  it("marks the container as a one-off and never as a service replica", () => {
    expect(spec.labels["deploykit.managed"]).toBe("true");
    expect(spec.labels["deploykit.oneoff"]).toBe("true");
    expect(spec.labels["deploykit.run"]).toBe(RUN_ID);
    expect(spec.labels["deploykit.service"]).toBeUndefined();
  });

  it("inherits volumes, limits and the shared network", () => {
    expect(spec.volumes).toEqual(["blog-data:/data"]);
    expect(spec.cpuMillicores).toBe(500);
    expect(spec.memoryMb).toBe(256);
    expect(spec.networkName).toBe("deploykit-network");
  });

  it("converts the timeout to milliseconds", () => {
    expect(spec.timeoutMs).toBe(120_000);
  });

  it("names the container after the run so it cannot collide", () => {
    expect(spec.name).toBe(`dk-oneoff-${RUN_ID.slice(0, 8)}`);
  });

  it("fails with a clear error when the app has never been deployed", () => {
    expect(() =>
      buildOneOffSpec({
        kind: "application",
        runId: RUN_ID,
        command: "ls",
        timeoutSeconds: 10,
        app: { ...app, containerImage: null } as unknown as ApplicationT,
        env: {},
      }),
    ).toThrow(OneOffNotDeployedError);
  });
});

describe("buildOneOffSpec — database", () => {
  const spec = buildOneOffSpec({
    kind: "database",
    runId: RUN_ID,
    command: 'psql -h "$DK_DB_HOST" -U "$DK_DB_USER" -c "select 1"',
    timeoutSeconds: 30,
    database,
    password: "p4ss",
  });

  it("uses the client image for the database type", () => {
    expect(spec.image).toBe("postgres:16-alpine");
  });

  it("exports the connection details and the type's password variable", () => {
    expect(spec.env).toContain("DK_DB_HOST=dk-maindb");
    expect(spec.env).toContain("DK_DB_USER=deploykit");
    expect(spec.env).toContain("DK_DB_NAME=app");
    expect(spec.env).toContain("DK_DB_PORT=5432");
    expect(spec.env).toContain("DK_DB_PASSWORD=p4ss");
    expect(spec.env).toContain("PGPASSWORD=p4ss");
  });

  it("uses MYSQL_PWD for mysql and REDISCLI_AUTH for redis", () => {
    const mysql = buildOneOffSpec({
      kind: "database",
      runId: RUN_ID,
      command: "mysql -e 'select 1'",
      timeoutSeconds: 30,
      database: { ...database, type: "mysql" } as unknown as DatabaseT,
      password: "p4ss",
    });
    expect(mysql.env).toContain("MYSQL_PWD=p4ss");

    const redis = buildOneOffSpec({
      kind: "database",
      runId: RUN_ID,
      command: "redis-cli ping",
      timeoutSeconds: 30,
      database: { ...database, type: "redis" } as unknown as DatabaseT,
      password: "p4ss",
    });
    expect(redis.env).toContain("REDISCLI_AUTH=p4ss");
  });

  it("never mounts the database's volumes into the client container", () => {
    expect(spec.volumes ?? []).toEqual([]);
  });
});
