import { describe, it, expect, vi } from "vitest";

import { gamePortSchema } from "@deploykit/shared";

/**
 * Host port allocation. Game clients connect straight to a host port, so two
 * servers must never get the same one — and a conflict should come with a
 * port that would work instead.
 */

vi.mock("../db/index", () => ({ db: {} }));
vi.mock("../lib/docker", () => ({ docker: {} }));

const { resolvePortPlan, describeConflicts, portKey } = await import("./game-ports");

const port = (p: Record<string, unknown>) => gamePortSchema.parse(p);
const RANGE = { from: 30000, to: 30010 };

describe("resolvePortPlan", () => {
  it("uses defaultHost, then the container port", () => {
    const { plan, conflicts } = resolvePortPlan(
      [
        port({ name: "game", protocol: "tcp", container: 25565, defaultHost: 25566 }),
        port({ name: "query", protocol: "udp", container: 27015 }),
      ],
      {},
      new Set(),
      RANGE,
    );
    expect(conflicts).toEqual([]);
    expect(plan).toEqual([
      { name: "game", protocol: "tcp", container: 25565, host: 25566 },
      { name: "query", protocol: "udp", container: 27015, host: 27015 },
    ]);
  });

  it("prefers the user's override", () => {
    const { plan } = resolvePortPlan(
      [port({ name: "game", protocol: "tcp", container: 25565, defaultHost: 25565 })],
      { game: 25600 },
      new Set(),
      RANGE,
    );
    expect(plan[0]!.host).toBe(25600);
    expect(plan[0]!.container).toBe(25565);
  });

  it("makes the container listen on the host port with matchHost", () => {
    const { plan } = resolvePortPlan(
      [port({ name: "game", protocol: "udp", container: 27015, matchHost: true })],
      { game: 27020 },
      new Set(),
      RANGE,
    );
    expect(plan[0]).toEqual({ name: "game", protocol: "udp", container: 27020, host: 27020 });
  });

  it("does not treat tcp and udp on one number as a conflict", () => {
    const { plan, conflicts } = resolvePortPlan(
      [port({ name: "game", protocol: "udp", container: 27015 })],
      {},
      new Set([portKey(27015, "tcp")]),
      RANGE,
    );
    expect(conflicts).toEqual([]);
    expect(plan[0]!.host).toBe(27015);
  });

  it("reports a taken port with a free suggestion from the range", () => {
    const used = new Set([portKey(25565, "tcp"), portKey(30000, "tcp")]);
    const { plan, conflicts } = resolvePortPlan(
      [port({ name: "game", protocol: "tcp", container: 25565, defaultHost: 25565 })],
      {},
      used,
      RANGE,
    );
    expect(plan).toEqual([]);
    expect(conflicts).toEqual([{ name: "game", protocol: "tcp", port: 25565, suggestion: 30001 }]);
    expect(describeConflicts(conflicts)).toBe(
      "Port 25565/tcp (game) is already in use; 30001 is free",
    );
  });

  it("keeps an offset port at its distance from the base port", () => {
    const { plan } = resolvePortPlan(
      [
        port({ name: "game", protocol: "udp", container: 2456, matchHost: true }),
        port({ name: "query", protocol: "udp", container: 2457, matchHost: true, offsetOf: "game", offset: 1 }),
      ],
      { game: 3000, query: 9999 },
      new Set(),
      RANGE,
    );
    expect(plan).toEqual([
      { name: "game", protocol: "udp", container: 3000, host: 3000 },
      { name: "query", protocol: "udp", container: 3001, host: 3001 },
    ]);
  });

  it("names the follower when only the follower's port is taken, and suggests a pair that fits", () => {
    const used = new Set([portKey(2457, "udp"), portKey(30001, "udp")]);
    const { conflicts } = resolvePortPlan(
      [
        port({ name: "game", protocol: "udp", container: 2456 }),
        port({ name: "query", protocol: "udp", container: 2457, offsetOf: "game", offset: 1 }),
      ],
      {},
      used,
      RANGE,
    );
    // 30000 is free but 30001 is not, so the pair starts at 30002.
    expect(conflicts).toEqual([{ name: "query", protocol: "udp", port: 2457, suggestion: 30003 }]);
  });

  it("never hands out the same port twice within one server", () => {
    const { conflicts } = resolvePortPlan(
      [
        port({ name: "a", protocol: "tcp", container: 7777 }),
        port({ name: "b", protocol: "tcp", container: 7778, defaultHost: 7777 }),
      ],
      {},
      new Set(),
      RANGE,
    );
    expect(conflicts.map((c) => c.name)).toEqual(["b"]);
  });

  it("gives no suggestion when the range is exhausted", () => {
    const used = new Set(
      Array.from({ length: 12 }, (_, i) => portKey(30000 + i, "tcp")).concat(portKey(80, "tcp")),
    );
    const { conflicts } = resolvePortPlan(
      [port({ name: "game", protocol: "tcp", container: 80 })],
      {},
      used,
      RANGE,
    );
    expect(conflicts[0]!.suggestion).toBeUndefined();
  });
});
