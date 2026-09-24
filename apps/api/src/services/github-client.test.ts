import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ghRequest,
  ghPaginate,
  GitHubApiError,
} from "./github-client";

const jsonResponse = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ghRequest", () => {
  it("sends the API version, accept header and credentials", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ slug: "deploykit" }));

    const { data } = await ghRequest<{ slug: string }>("/app", {
      auth: { scheme: "Bearer", value: "jwt-value" },
    });

    expect(data.slug).toBe("deploykit");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/app");
    expect(init.headers.Accept).toBe("application/vnd.github+json");
    expect(init.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(init.headers.Authorization).toBe("Bearer jwt-value");
  });

  it("honours a per-App API base URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await ghRequest("/app", { baseUrl: "https://ghe.acme.io/api/v3" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://ghe.acme.io/api/v3/app");
  });

  it("surfaces GitHub's own message and documentation URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: "Bad credentials",
          documentation_url: "https://docs.github.com/rest",
        },
        { status: 401 },
      ),
    );

    await expect(ghRequest("/app")).rejects.toMatchObject({
      status: 401,
      message: "Bad credentials",
      docUrl: "https://docs.github.com/rest",
    });
  });

  it("folds validation errors into the message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: "Validation Failed",
          errors: [{ message: "No commit found for SHA" }],
        },
        { status: 422 },
      ),
    );

    await expect(ghRequest("/repos/a/b/statuses/deadbeef")).rejects.toThrow(
      /Validation Failed \(No commit found for SHA\)/,
    );
  });

  it("never leaks the credential into the error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Bad credentials" }, { status: 401 }),
    );

    const secret = "ghs_supersecrettokenvalue0123456789";
    const err = await ghRequest("/app", {
      auth: { scheme: "token", value: secret },
    }).then(
      () => {
        throw new Error("expected the request to fail");
      },
      (e: unknown) => e as GitHubApiError,
    );

    expect(err).toBeInstanceOf(GitHubApiError);
    expect(JSON.stringify(err)).not.toContain(secret);
    expect(err.message).not.toContain(secret);
  });

  it("retries once when the rate limit budget is exhausted", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 2),
            },
          },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const pending = ghRequest<{ ok: boolean }>("/app");
    await vi.advanceTimersByTimeAsync(5_000);

    expect((await pending).data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 403 that is a permissions problem", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { message: "Resource not accessible by integration" },
        { status: 403, headers: { "x-ratelimit-remaining": "4999" } },
      ),
    );

    await expect(ghRequest("/repos/a/b/statuses/x")).rejects.toMatchObject({
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and gives up after three attempts", async () => {
    vi.useFakeTimers();
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(async () =>
      jsonResponse({ message: "Server Error" }, { status: 502 }),
    );

    const pending = ghRequest("/app").then(
      () => {
        throw new Error("expected the request to fail");
      },
      (e) => e as GitHubApiError,
    );
    await vi.advanceTimersByTimeAsync(10_000);

    expect((await pending).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a timeout as a GitHubApiError rather than an AbortError", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "TimeoutError" }),
    );

    await expect(ghRequest("/app")).rejects.toMatchObject({
      status: 0,
      message: "GitHub request failed: request timed out",
    });
  });
});

describe("ghPaginate", () => {
  it("follows Link rel=next and concatenates pages", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { repositories: [{ full_name: "acme/one" }] },
          {
            headers: {
              link: '<https://api.github.com/installation/repositories?page=2>; rel="next"',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ repositories: [{ full_name: "acme/two" }] }),
      );

    const { items, truncated } = await ghPaginate<string>(
      "/installation/repositories",
      {},
      (page) => page.repositories.map((r: any) => r.full_name),
    );

    expect(items).toEqual(["acme/one", "acme/two"]);
    expect(truncated).toBe(false);
    expect(fetchMock.mock.calls[1]![0]).toBe(
      "https://api.github.com/installation/repositories?page=2",
    );
  });

  it("stops at maxPages and says so", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        { repositories: [{ full_name: "acme/repo" }] },
        {
          headers: {
            link: '<https://api.github.com/installation/repositories?page=9>; rel="next"',
          },
        },
      ),
    );

    const { items, truncated } = await ghPaginate<string>(
      "/installation/repositories",
      {},
      (page) => page.repositories.map((r: any) => r.full_name),
      2,
    );

    expect(items).toHaveLength(2);
    expect(truncated).toBe(true);
  });
});
