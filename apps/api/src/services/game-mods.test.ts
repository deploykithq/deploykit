import { describe, it, expect, vi } from "vitest";

/**
 * The parts of the mod service that decide what fits a server: LATEST is
 * resolved to a concrete version before searching, a loader without mods is
 * explained rather than failing, and a modpack's metadata is read off the
 * version that was picked.
 */

vi.mock("../db/index", () => ({ db: {} }));
vi.mock("../lib/redis", () => ({ redis: { get: vi.fn(async () => null), set: vi.fn() } }));
vi.mock("./instance-settings", () => ({ getSetting: vi.fn(async () => null) }));
vi.mock("./mod-sources/index", async (orig) => ({
  ...(await orig<typeof import("./mod-sources/index")>()),
  resolveVersionAlias: vi.fn(async () => "1.21.4"),
}));

const { resolveFilter, modpackFromVersion, GameModError } = await import("./game-mods");

const SPEC: any = {
  variables: [
    {
      key: "server_type",
      label: "Server type",
      type: "select",
      options: [
        { label: "V", value: "VANILLA" },
        { label: "F", value: "FABRIC" },
      ],
    },
    { key: "mc_version", label: "Version", type: "string" },
  ],
  mods: {
    sources: [{ source: "modrinth", env: "MODRINTH_PROJECTS" }],
    loader: { from: "server_type", map: { FABRIC: { loaders: ["fabric"], kind: "mod" } } },
    gameVersion: { from: "mc_version", aliases: { LATEST: "release" } },
    modpacks: [],
    directories: [],
  },
};
const row: any = { id: "s1", spec: SPEC, modpack: null, appliedModEnv: null };

describe("resolveFilter", () => {
  it("resolves LATEST to a concrete version", async () => {
    expect(await resolveFilter(row, { server_type: "FABRIC", mc_version: "LATEST" })).toEqual({
      loaders: ["fabric"],
      kind: "mod",
      gameVersion: "1.21.4",
    });
  });

  it("lets the caller ask for another kind (modpacks)", async () => {
    expect(
      await resolveFilter(row, { server_type: "FABRIC", mc_version: "1.20.1" }, "modpack"),
    ).toMatchObject({ kind: "modpack", gameVersion: "1.20.1" });
  });

  it("explains a loader without mods as PRECONDITION_FAILED", async () => {
    await expect(
      resolveFilter(row, { server_type: "VANILLA", mc_version: "1.21.4" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(resolveFilter(row, { server_type: "VANILLA" })).rejects.toBeInstanceOf(
      GameModError,
    );
  });
});

describe("modpackFromVersion", () => {
  it("takes the first game version and the first real loader", () => {
    const pack = modpackFromVersion(
      { source: "modrinth", projectId: "P1", slug: "pack", name: "Pack", iconUrl: null },
      {
        id: "V1",
        label: "1.0",
        gameVersions: ["1.20.1"],
        loaders: ["minecraft", "fabric"],
        publishedAt: "",
        type: "release",
      },
    );
    expect(pack).toEqual({
      source: "modrinth",
      projectId: "P1",
      slug: "pack",
      name: "Pack",
      iconUrl: null,
      versionId: "V1",
      versionLabel: "1.0",
      gameVersion: "1.20.1",
      loader: "fabric",
    });
  });
});
