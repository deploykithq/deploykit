import { describe, it, expect } from "vitest";

import {
  taskTargetSchema,
  createTaskSchema,
  runAdHocSchema,
  TASK_TIMEOUT_DEFAULT_SECONDS,
} from "@deploykit/shared";

const APP_ID = "11111111-1111-4111-8111-111111111111";

describe("taskTargetSchema", () => {
  it("accepts an application target without a service name", () => {
    expect(taskTargetSchema.parse({ kind: "application", id: APP_ID })).toEqual({
      kind: "application",
      id: APP_ID,
    });
  });

  it("requires a service name for a compose target", () => {
    expect(
      taskTargetSchema.safeParse({ kind: "compose", id: APP_ID }).success,
    ).toBe(false);
  });

  it("rejects a service name on a non-compose target", () => {
    expect(
      taskTargetSchema.safeParse({
        kind: "database",
        id: APP_ID,
        serviceName: "db",
      }).success,
    ).toBe(false);
  });
});

describe("createTaskSchema", () => {
  const base = {
    target: { kind: "application" as const, id: APP_ID },
    name: "Schedule run",
    command: "php artisan schedule:run",
  };

  it("defaults timezone, enabled and timeout, and leaves cron absent", () => {
    const parsed = createTaskSchema.parse(base);
    expect(parsed.timezone).toBe("UTC");
    expect(parsed.enabled).toBe(true);
    expect(parsed.timeoutSeconds).toBe(TASK_TIMEOUT_DEFAULT_SECONDS);
    expect(parsed.cron ?? null).toBeNull();
  });

  it("accepts an explicit null cron (a manual-only saved command)", () => {
    expect(createTaskSchema.parse({ ...base, cron: null }).cron).toBeNull();
  });

  it("rejects an empty command and an over-long one", () => {
    expect(createTaskSchema.safeParse({ ...base, command: "   " }).success).toBe(
      false,
    );
    expect(
      createTaskSchema.safeParse({ ...base, command: "x".repeat(4001) })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown timezone", () => {
    expect(
      createTaskSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success,
    ).toBe(false);
  });

  it("rejects a timeout outside 1…86400", () => {
    expect(
      createTaskSchema.safeParse({ ...base, timeoutSeconds: 0 }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ ...base, timeoutSeconds: 86_401 }).success,
    ).toBe(false);
  });
});

describe("runAdHocSchema", () => {
  it("keeps the same command rules as a saved task", () => {
    expect(
      runAdHocSchema.safeParse({
        target: { kind: "application", id: APP_ID },
        command: "",
      }).success,
    ).toBe(false);
  });
});
