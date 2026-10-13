import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Instance settings hold third-party API keys: stored encrypted, read back
 * decrypted, and reported to the UI only as "configured + last four".
 */

const store = new Map<string, { key: string; value: string }>();

vi.mock("../db/index", () => ({
  db: {
    query: {
      instanceSettings: {
        findFirst: vi.fn(async ({ where }: any) => store.get(where.__key) ?? undefined),
      },
    },
    insert: () => ({
      values: (row: any) => ({
        onConflictDoUpdate: async () => {
          store.set(row.key, row);
        },
      }),
    }),
    delete: () => ({
      where: async (w: any) => {
        store.delete(w.__key);
      },
    }),
  },
}));
vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: (_col: unknown, key: string) => ({ __key: key }),
}));
vi.mock("../lib/encryption", () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, "$1"),
}));

const { getSetting, setSetting, settingStatus, clearSettingsCache } = await import(
  "./instance-settings"
);

beforeEach(() => {
  store.clear();
  clearSettingsCache();
});

describe("instance settings", () => {
  it("stores encrypted and reads back decrypted", async () => {
    await setSetting("curseforge_api_key", "secret-abcd", null);
    expect(store.get("curseforge_api_key")!.value).toBe("enc(secret-abcd)");
    expect(await getSetting("curseforge_api_key")).toBe("secret-abcd");
  });

  it("reports status without the value", async () => {
    expect(await settingStatus("steam_web_api_key")).toEqual({ configured: false, last4: null });
    await setSetting("steam_web_api_key", "0123456789ABCDEF", null);
    expect(await settingStatus("steam_web_api_key")).toEqual({ configured: true, last4: "CDEF" });
  });

  it("clears with null and invalidates the cache", async () => {
    await setSetting("curseforge_api_key", "secret-abcd", null);
    expect(await getSetting("curseforge_api_key")).toBe("secret-abcd");
    await setSetting("curseforge_api_key", null, null);
    expect(await getSetting("curseforge_api_key")).toBeNull();
  });
});
