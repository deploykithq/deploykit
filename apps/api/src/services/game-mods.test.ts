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

const { resolveFilter, resolveRequired, modpackFromVersion, GameModError } = await import(
  "./game-mods"
);
const { steamWorkshop } = await import("./mod-sources/steam");
const { ModSourceError } = await import("./mod-sources/index");

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

describe("resolveRequired", () => {
  const TML_SPEC: any = {
    mods: {
      sources: [{ source: "steam-workshop", appId: 1281930, env: "DK_MODS_STEAM" }],
      modpacks: [],
      directories: [],
    },
  };
  const FILTER = { loaders: null, kind: "mod" as const, gameVersion: null };
  const summary = (id: string, installable = true) => ({
    source: "steam-workshop" as const,
    projectId: id,
    slug: null,
    name: `Mod ${id}`,
    summary: "",
    iconUrl: null,
    author: null,
    downloads: 0,
    url: "",
    kind: "mod" as const,
    installable,
    ...(installable ? {} : { reason: "gone" }),
  });
  const VERSION = {
    id: "1",
    label: "Updated 2026-01-01",
    gameVersions: [],
    loaders: [],
    publishedAt: "",
    type: "release" as const,
  };

  const stub = (tree: Record<string, string[] | null>, broken: string[] = []) => {
    vi.spyOn(steamWorkshop, "requires").mockImplementation(async (id) => {
      if (!(id in tree)) return [];
      return tree[id]!;
    });
    vi.spyOn(steamWorkshop, "project").mockImplementation(async (id) => {
      if (broken.includes(id)) throw new ModSourceError("NOT_FOUND", `Item ${id} not found`);
      return summary(id, id !== "dead");
    });
    vi.spyOn(steamWorkshop, "versions").mockImplementation(async () => [VERSION]);
  };

  it("walks the tree once per item, cycles included", async () => {
    stub({ root: ["a", "b"], a: ["c", "root"], b: ["a"], c: [] });
    const r = await resolveRequired(TML_SPEC, "steam-workshop", "root", FILTER);
    expect(r.checked).toBe(true);
    expect(r.items.map((i) => i.project.projectId)).toEqual(["a", "b", "c"]);
    expect(r.skipped).toEqual([]);
  });

  it("reports it could not check without a key", async () => {
    stub({ root: null });
    const r = await resolveRequired(TML_SPEC, "steam-workshop", "root", FILTER);
    expect(r).toMatchObject({ checked: false, items: [] });
    expect(r.reason).toMatch(/Steam Web API key/);
  });

  it("does not fail the add when the provider rejects the key", async () => {
    stub({});
    vi.spyOn(steamWorkshop, "requires").mockRejectedValue(
      new ModSourceError("UNAUTHORIZED", "the Steam Workshop rejected the API key"),
    );
    const r = await resolveRequired(TML_SPEC, "steam-workshop", "root", FILTER);
    expect(r).toMatchObject({ checked: false, reason: "the Steam Workshop rejected the API key" });
  });

  it("skips required items it cannot install, keeping the rest", async () => {
    stub({ root: ["a", "dead", "missing"] }, ["missing"]);
    const r = await resolveRequired(TML_SPEC, "steam-workshop", "root", FILTER);
    expect(r.items.map((i) => i.project.projectId)).toEqual(["a"]);
    expect(r.skipped.map((s) => s.projectId)).toEqual(["dead", "missing"]);
  });

  it("stops at a bounded number of required items", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `m${i}`);
    stub({ root: many });
    const r = await resolveRequired(TML_SPEC, "steam-workshop", "root", FILTER);
    expect(r.items).toHaveLength(25);
    expect(r.skipped).toHaveLength(15);
  });

  it("does nothing for sources whose image resolves dependencies", async () => {
    const spec: any = {
      mods: { sources: [{ source: "modrinth", env: "X" }], modpacks: [], directories: [] },
    };
    expect(await resolveRequired(spec, "modrinth", "P", FILTER)).toEqual({
      checked: true,
      items: [],
      skipped: [],
    });
  });
});
