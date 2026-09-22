import { describe, it, expect } from "vitest";

import { assertValidCron, nextRunAt, nextRuns, InvalidCronError } from "./cron";

describe("assertValidCron", () => {
  it("accepts the presets the UI offers, including every minute", () => {
    for (const pattern of [
      "* * * * *",
      "*/5 * * * *",
      "0 * * * *",
      "0 2 * * *",
      "0 0 * * 0",
      "0 0 1 * *",
    ]) {
      expect(() => assertValidCron(pattern, "UTC")).not.toThrow();
    }
  });

  it("rejects a malformed pattern", () => {
    expect(() => assertValidCron("not a cron", "UTC")).toThrow(InvalidCronError);
    expect(() => assertValidCron("99 * * * *", "UTC")).toThrow(InvalidCronError);
  });

  it("rejects a 6-field pattern: sub-minute schedules are out of scope", () => {
    expect(() => assertValidCron("*/30 * * * * *", "UTC")).toThrow(
      InvalidCronError,
    );
  });

  it("rejects an unknown timezone", () => {
    expect(() => assertValidCron("0 2 * * *", "Mars/Olympus")).toThrow(
      InvalidCronError,
    );
  });
});

describe("nextRunAt", () => {
  it("resolves the next occurrence in the given timezone", () => {
    // 2026-01-01T00:30:00Z is 01:30 in Madrid (UTC+1 in winter), so the next
    // 02:00 Madrid is 01:00Z the same day.
    const from = new Date("2026-01-01T00:30:00Z");
    expect(nextRunAt("0 2 * * *", "Europe/Madrid", from).toISOString()).toBe(
      "2026-01-01T01:00:00.000Z",
    );
    expect(nextRunAt("0 2 * * *", "UTC", from).toISOString()).toBe(
      "2026-01-01T02:00:00.000Z",
    );
  });

  it("returns consecutive occurrences", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(
      nextRuns("*/15 * * * *", "UTC", 3, from).map((d) => d.toISOString()),
    ).toEqual([
      "2026-01-01T00:15:00.000Z",
      "2026-01-01T00:30:00.000Z",
      "2026-01-01T00:45:00.000Z",
    ]);
  });
});
