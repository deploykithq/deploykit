import { describe, it, expect, vi } from "vitest";

import {
  generateApiToken,
  hashApiToken,
  isApiToken,
  isExpired,
  resolveApiToken,
  tokenAllowsCall,
} from "./api-tokens";

const user = { id: "u1", email: "agent@example.com", role: "viewer" };

/** A stand-in for drizzle exposing only what `resolveApiToken` touches. */
const fakeDb = (row: unknown) => {
  const where = vi.fn(() => Promise.resolve());
  const db = {
    query: { apiTokens: { findFirst: vi.fn(async () => row) } },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
  };
  return db as any;
};

describe("generateApiToken", () => {
  it("makes a prefixed token whose hash and display prefix match it", () => {
    const { token, hash, prefix } = generateApiToken();
    expect(isApiToken(token)).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hash).toBe(hashApiToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(token.length / 2);
  });

  it("never repeats", () => {
    expect(generateApiToken().token).not.toBe(generateApiToken().token);
  });

  it("does not mistake a JWT for an API token", () => {
    expect(isApiToken("eyJhbGciOiJIUzI1NiJ9.e30.x")).toBe(false);
  });
});

describe("isExpired", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("treats a null expiry as never", () => {
    expect(isExpired({ expiresAt: null }, now)).toBe(false);
  });
  it("expires at the instant, not after it", () => {
    expect(isExpired({ expiresAt: now }, now)).toBe(true);
    expect(isExpired({ expiresAt: new Date(now.getTime() + 1) }, now)).toBe(false);
  });
});

describe("tokenAllowsCall", () => {
  it("does not restrict a session", () => {
    expect(tokenAllowsCall(null, "mutation")).toBe(true);
  });
  it("limits a read token to queries", () => {
    expect(tokenAllowsCall({ scope: "read" }, "query")).toBe(true);
    expect(tokenAllowsCall({ scope: "read" }, "mutation")).toBe(false);
    expect(tokenAllowsCall({ scope: "read" }, "subscription")).toBe(false);
  });
  it("lets a write token mutate", () => {
    expect(tokenAllowsCall({ scope: "write" }, "mutation")).toBe(true);
  });
});

describe("resolveApiToken", () => {
  const { token } = generateApiToken();
  const row = {
    id: "t1",
    name: "agent",
    scope: "write",
    expiresAt: null,
    lastUsedAt: null,
    user,
  };

  it("resolves a known token to its user and scope", async () => {
    const db = fakeDb(row);
    expect(await resolveApiToken(db, token)).toEqual({
      user,
      apiToken: { id: "t1", name: "agent", scope: "write" },
    });
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("rejects an unknown token", async () => {
    expect(await resolveApiToken(fakeDb(undefined), token)).toBeNull();
  });

  it("rejects an expired token without touching last_used_at", async () => {
    const db = fakeDb({ ...row, expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveApiToken(db, token)).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("never queries for something that is not an API token", async () => {
    const db = fakeDb(row);
    expect(await resolveApiToken(db, "not-a-token")).toBeNull();
    expect(db.query.apiTokens.findFirst).not.toHaveBeenCalled();
  });
});
