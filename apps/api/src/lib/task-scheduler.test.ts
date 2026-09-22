import { describe, it, expect } from "vitest";

import {
  diffSchedules,
  taskSchedulerId,
  backupSchedulerId,
} from "./task-scheduler";

describe("scheduler ids", () => {
  it("namespaces tasks and backups so one reconcile cannot delete the other", () => {
    expect(taskSchedulerId("abc")).toBe("task:abc");
    expect(backupSchedulerId("abc")).toBe("backup:abc");
  });
});

describe("diffSchedules", () => {
  it("upserts everything the DB wants", () => {
    const diff = diffSchedules(
      [{ id: "task:1", pattern: "0 2 * * *", timezone: "UTC" }],
      [],
      "task",
    );
    expect(diff.toUpsert).toEqual([
      { id: "task:1", pattern: "0 2 * * *", timezone: "UTC" },
    ]);
    expect(diff.toRemove).toEqual([]);
  });

  it("removes a scheduler the DB no longer wants", () => {
    const diff = diffSchedules([], ["task:1", "task:2"], "task");
    expect(diff.toUpsert).toEqual([]);
    expect(diff.toRemove).toEqual(["task:1", "task:2"]);
  });

  it("re-upserts an existing id so a changed pattern takes effect", () => {
    const diff = diffSchedules(
      [{ id: "task:1", pattern: "*/5 * * * *" }],
      ["task:1"],
      "task",
    );
    expect(diff.toUpsert).toEqual([{ id: "task:1", pattern: "*/5 * * * *" }]);
    expect(diff.toRemove).toEqual([]);
  });

  it("never removes another namespace's schedulers", () => {
    // Reconciling tasks must leave backup schedulers untouched, even when no
    // task wants anything — which is exactly the case where an inferred
    // prefix would have been unavailable.
    const diff = diffSchedules([], ["task:1", "backup:9"], "task");
    expect(diff.toRemove).toEqual(["task:1"]);
  });
});
