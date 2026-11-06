import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";

/**
 * These tests exercise JWT signing and the installation-token cache.
 *
 * Redis and the database are stubbed rather than reached: the cache's contract
 * (single-flight, expiry, invalidation) is observable entirely through how many
 * times GitHub is asked for a token.
 */

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** A second App, owned by another account, with a key of its own. */
const orgKeys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const APP_ROW = {
  id: "app-uuid",
  appId: 123456,
  slug: "deploykit-test",
  name: "DeployKit Test",
  privateKey: "encrypted-pem",
  webhookSecret: "encrypted-secret",
  apiBaseUrl: "https://api.github.com",
  webBaseUrl: "https://github.com",
} as any;

const ORG_APP_ROW = {
  ...APP_ROW,
  id: "org-app-uuid",
  appId: 654321,
  slug: "deploykit-acme-inc",
  privateKey: "encrypted-org-pem",
} as any;

const ORG_INSTALLATION = {
  id: "org-inst-uuid",
  githubAppId: "org-app-uuid",
  installationId: 77,
  accountLogin: "acme-inc",
  suspendedAt: null,
} as any;

const INSTALLATION = {
  id: "inst-uuid",
  githubAppId: "app-uuid",
  installationId: 42,
  accountLogin: "acme",
  suspendedAt: null,
} as any;

/** A stand-in Redis with just the commands this service uses. */
const store = new Map<string, string>();
const redisStub = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
    return "OK";
  }),
  del: vi.fn(async (k: string) => {
    store.delete(k);
    return 1;
  }),
};

vi.mock("../lib/redis", () => ({ redis: redisStub }));
vi.mock("../lib/encryption", () => ({
  // The cache stores ciphertext; a reversible marker is enough to prove the
  // value round-trips through encrypt/decrypt rather than being stored raw.
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) =>
    s === "encrypted-pem"
      ? privateKey
      : s === "encrypted-org-pem"
        ? orgKeys.privateKey
        : s.replace(/^enc\((.*)\)$/, "$1"),
}));
vi.mock("../db/index", () => ({
  db: {
    query: {
      githubApps: { findMany: async () => [APP_ROW, ORG_APP_ROW] },
      githubInstallations: { findFirst: async () => INSTALLATION },
    },
  },
}));

let fetchMock: ReturnType<typeof vi.fn>;
let service: typeof import("./github-app");

beforeEach(async () => {
  store.clear();
  vi.clearAllMocks();
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  service = await import("./github-app");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const tokenResponse = (token: string, minutesValid = 60) =>
  new Response(
    JSON.stringify({
      token,
      expires_at: new Date(Date.now() + minutesValid * 60_000).toISOString(),
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );

describe("signAppJwt", () => {
  it("produces an RS256 token the App's public key verifies", () => {
    const token = service.signAppJwt(APP_ROW);
    const claims = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
    }) as jwt.JwtPayload;

    expect(claims.iss).toBe("123456");
  });

  it("backdates iat and expires within GitHub's 10 minute ceiling", () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = jwt.verify(service.signAppJwt(APP_ROW), publicKey, {
      algorithms: ["RS256"],
    }) as jwt.JwtPayload;

    // Backdated, so GitHub never sees an iat in its own future.
    expect(claims.iat!).toBeLessThan(now);
    expect(claims.exp! - claims.iat!).toBeLessThanOrEqual(600);
  });

  it("is rejected by any other key", () => {
    const other = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).publicKey;

    expect(() =>
      jwt.verify(service.signAppJwt(APP_ROW), other, { algorithms: ["RS256"] }),
    ).toThrow();
  });
});

describe("getInstallationToken", () => {
  it("mints once and serves the rest from cache", async () => {
    fetchMock.mockImplementation(async () => tokenResponse("ghs_first"));

    expect(await service.getInstallationToken(INSTALLATION)).toBe("ghs_first");
    expect(await service.getInstallationToken(INSTALLATION)).toBe("ghs_first");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores the cached token encrypted, never in the clear", async () => {
    fetchMock.mockImplementation(async () => tokenResponse("ghs_secret"));
    await service.getInstallationToken(INSTALLATION);

    const cached = store.get("gh:itok:42");
    expect(cached).toBe("enc(ghs_secret)");
    expect(cached).not.toBe("ghs_secret");
  });

  it("mints once for a burst of concurrent callers", async () => {
    // The point of the single-flight map: ten deploys of the same
    // installation starting together must not make ten token requests.
    fetchMock.mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(tokenResponse("ghs_shared")), 10),
        ),
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.getInstallationToken(INSTALLATION),
      ),
    );

    expect(new Set(results)).toEqual(new Set(["ghs_shared"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-mints after the cached token is invalidated", async () => {
    fetchMock
      .mockImplementationOnce(async () => tokenResponse("ghs_one"))
      .mockImplementationOnce(async () => tokenResponse("ghs_two"));

    expect(await service.getInstallationToken(INSTALLATION)).toBe("ghs_one");
    await service.invalidateInstallationToken(42);
    expect(await service.getInstallationToken(INSTALLATION)).toBe("ghs_two");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a token that is already within the safety margin", async () => {
    // Expiry minus the five-minute margin is in the past, so caching it would
    // hand out a credential that dies mid-clone.
    fetchMock.mockImplementation(async () => tokenResponse("ghs_short", 2));

    await service.getInstallationToken(INSTALLATION);
    expect(store.has("gh:itok:42")).toBe(false);
  });

  it("refuses to mint for a suspended installation", async () => {
    await expect(
      service.getInstallationToken({
        ...INSTALLATION,
        suspendedAt: new Date(),
      }),
    ).rejects.toThrow(/suspended/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("with several Apps", () => {
  it("mints each installation's token with its own App's key", async () => {
    const issuers: string[] = [];
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get("authorization") ?? "";
      const token = auth.replace(/^Bearer /, "");
      const key = url.includes("/installations/77/")
        ? orgKeys.publicKey
        : publicKey;
      // Throws if the JWT was signed with the other App's key.
      const claims = jwt.verify(token, key, {
        algorithms: ["RS256"],
      }) as jwt.JwtPayload;
      issuers.push(String(claims.iss));
      return tokenResponse(`ghs_${claims.iss}`);
    });

    expect(await service.getInstallationToken(INSTALLATION)).toBe(
      "ghs_123456",
    );
    expect(await service.getInstallationToken(ORG_INSTALLATION)).toBe(
      "ghs_654321",
    );
    expect(issuers).toEqual(["123456", "654321"]);
  });

  it("fails readably when an installation's App is gone", async () => {
    await expect(
      service.getInstallationToken({
        ...INSTALLATION,
        githubAppId: "deleted-app",
      }),
    ).rejects.toThrow(/no longer configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks Apps up by local id and by GitHub id", async () => {
    expect((await service.getGitHubAppById("org-app-uuid"))?.appId).toBe(
      654321,
    );
    expect((await service.getGitHubAppByAppId(123456))?.id).toBe("app-uuid");
    expect(await service.getGitHubAppById("nope")).toBeNull();
  });
});

describe("asInstallation", () => {
  it("re-mints and retries exactly once when a cached token is rejected", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      calls++;
      if (url.endsWith("/access_tokens")) return tokenResponse(`ghs_${calls}`);
      // First API call fails as if the token had been revoked.
      if (calls <= 2) {
        return new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ full_name: "acme/api" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const repo = await service.asInstallation<{ full_name: string }>(
      INSTALLATION,
      "/repositories/7",
    );

    expect(repo.full_name).toBe("acme/api");
    // mint, 401, re-mint, success
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("gives up if the retry is rejected too", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/access_tokens")) return tokenResponse("ghs_x");
      return new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      service.asInstallation(INSTALLATION, "/repositories/7"),
    ).rejects.toMatchObject({ status: 401 });
  });
});
