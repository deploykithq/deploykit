import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * "Update image": the catalogue's tag is taken only for the same contract and
 * only when it resolves with the snapshot's variables; a new build of the
 * same tag is found by comparing the registry's digest with the running one.
 */

const getGame = vi.fn();
const containerInspect = vi.fn();
const imageInspect = vi.fn();
const distribution = vi.fn();

vi.mock("./game-catalog", () => ({ getGame: (id: string) => getGame(id) }));
vi.mock("../lib/docker", () => ({
  docker: {
    getContainer: () => ({ inspect: () => containerInspect() }),
    getImage: (ref: string) => ({
      inspect: () => imageInspect(ref),
      distribution: () => distribution(ref),
    }),
  },
}));
vi.mock("./game-server", () => ({
  allValues: (row: any) => ({ ...row.config }),
  loadGameServerPorts: async () => [],
  substitutionValues: (_row: unknown, values: Record<string, string>) => values,
  resolveImage: (spec: any, values: Record<string, string>) => {
    const image = String(spec.image).replace(/\$\{(\w+)\}/g, (m, k) => values[k] ?? m);
    if (image.includes("$")) throw new Error(`"${image}" is not a valid image reference`);
    return image;
  },
}));

const { checkImageUpdate, catalogueImage, isNewBuild, mayUpdateImage } = await import(
  "./game-image"
);

const TML = "ghcr.io/deploykithq/game-tmodloader";
const row = (over: Record<string, unknown> = {}): any => ({
  id: "s1",
  name: "terra",
  gameId: "terraria-tmodloader",
  memoryMb: 2048,
  config: { java_tag: "java21" },
  secretConfig: null,
  containerId: "c1",
  spec: { contract: 1, image: `${TML}:0.1`, variables: [{ key: "java_tag" }] },
  ...over,
});

beforeEach(() => {
  getGame.mockReset();
  containerInspect.mockReset().mockResolvedValue({ Image: "sha256:img" });
  imageInspect.mockReset().mockResolvedValue({ RepoDigests: [`${TML}@sha256:old`] });
  distribution.mockReset().mockResolvedValue({ Descriptor: { digest: "sha256:old" } });
});

describe("catalogueImage", () => {
  it("takes a moved tag for the same contract", async () => {
    getGame.mockResolvedValue({ contract: 1, image: `${TML}:0.2` });
    expect(await catalogueImage(row())).toBe(`${TML}:0.2`);
  });

  it("ignores an unchanged image, another contract, a third-party snapshot", async () => {
    getGame.mockResolvedValue({ contract: 1, image: `${TML}:0.1` });
    expect(await catalogueImage(row())).toBeNull();
    getGame.mockResolvedValue({ contract: undefined, image: `${TML}:0.2` });
    expect(await catalogueImage(row())).toBeNull();
    getGame.mockResolvedValue({ contract: 1, image: `${TML}:0.2` });
    expect(await catalogueImage(row({ spec: { image: "itzg/x:1", variables: [] } }))).toBeNull();
  });

  it("refuses an image that references a variable the snapshot lacks", async () => {
    getGame.mockResolvedValue({ contract: 1, image: `${TML}:0.2-\${flavour}` });
    expect(await catalogueImage(row())).toBeNull();
  });

  it("survives a registry outage", async () => {
    getGame.mockRejectedValue(new Error("down"));
    expect(await catalogueImage(row())).toBeNull();
  });
});

describe("checkImageUpdate", () => {
  it("offers the catalogue's new tag, resolved", async () => {
    getGame.mockResolvedValue({ contract: 1, image: `${TML}:0.2-\${java_tag}` });
    expect(await checkImageUpdate(row())).toEqual({
      current: `${TML}:0.1`,
      target: `${TML}:0.2-java21`,
      specImage: `${TML}:0.2-\${java_tag}`,
      newBuild: null,
      available: true,
    });
    expect(distribution).not.toHaveBeenCalled();
  });

  it("offers a new build of the same tag", async () => {
    getGame.mockResolvedValue({ contract: 1, image: `${TML}:0.1` });
    distribution.mockResolvedValue({ Descriptor: { digest: "sha256:new" } });
    expect(await checkImageUpdate(row())).toMatchObject({
      target: `${TML}:0.1`,
      specImage: null,
      newBuild: true,
      available: true,
    });
  });

  it("is up to date when the running digest is the registry's", async () => {
    getGame.mockResolvedValue(null);
    expect(await checkImageUpdate(row())).toMatchObject({ newBuild: false, available: false });
  });

  it("does not guess when the registry cannot be asked", async () => {
    getGame.mockResolvedValue(null);
    distribution.mockRejectedValue(new Error("unauthorized"));
    expect(await checkImageUpdate(row())).toMatchObject({ newBuild: null, available: false });
  });

  it("does not compare builds for a server never provisioned", async () => {
    getGame.mockResolvedValue(null);
    expect(await checkImageUpdate(row({ containerId: null }))).toMatchObject({
      newBuild: null,
      available: false,
    });
    expect(distribution).not.toHaveBeenCalled();
  });
});

describe("isNewBuild / mayUpdateImage", () => {
  it("compares digests only when both are known", () => {
    expect(isNewBuild(["sha256:a"], "sha256:a")).toBe(false);
    expect(isNewBuild(["sha256:a"], "sha256:b")).toBe(true);
    expect(isNewBuild(null, "sha256:b")).toBeNull();
    expect(isNewBuild(["sha256:a"], null)).toBeNull();
  });

  it("needs a requested safety backup to have worked", () => {
    expect(mayUpdateImage(null)).toEqual({ ok: true });
    expect(mayUpdateImage({ status: "success", error: null })).toEqual({ ok: true });
    expect(mayUpdateImage({ status: "failed", error: "Nothing to back up yet: x" })).toEqual({
      ok: true,
    });
    expect(mayUpdateImage({ status: "failed", error: "disk full" })).toMatchObject({ ok: false });
  });
});
