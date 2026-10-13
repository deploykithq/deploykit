import { describe, it, expect } from "vitest";

import {
  compatFilter,
  isDestructiveChange,
  mayApplyMods,
  modEnvForProvision,
  modEnvPending,
  renderModEnv,
  snapshotModEnv,
} from "./game-mods-env";

/**
 * A server's mod list becomes the env vars its image reads. The image does
 * the downloading and deletes what leaves the list, so every source var is
 * always emitted — an empty one is how the last mod gets removed.
 */

const MODS = {
  sources: [
    { source: "modrinth" as const, env: "MODRINTH_PROJECTS" },
    { source: "curseforge" as const, env: "CURSEFORGE_FILES", apiKeyEnv: "CF_API_KEY" },
  ],
  loader: {
    from: "server_type",
    map: {
      FABRIC: { loaders: ["fabric"], kind: "mod" as const },
      PAPER: { loaders: ["paper", "bukkit", "spigot"], kind: "plugin" as const },
    },
  },
  gameVersion: {
    from: "mc_version",
    aliases: { LATEST: "release" as const, SNAPSHOT: "any" as const },
  },
  modpacks: [
    {
      source: "modrinth" as const,
      env: {
        TYPE: "MODRINTH",
        MODRINTH_MODPACK: "${dk_modpack_project}",
        MODRINTH_VERSION: "${dk_modpack_version}",
        VERSION: "${dk_modpack_game_version}",
      },
    },
  ],
  directories: [],
};
const STEAM = {
  sources: [
    {
      source: "steam-workshop" as const,
      env: "TMOD_AUTODOWNLOAD",
      enabledEnv: "TMOD_ENABLEDMODS",
      appId: 1281930,
    },
  ],
  modpacks: [],
  directories: [],
};
const PACK = {
  source: "modrinth" as const,
  projectId: "P1",
  slug: "pack",
  name: "Pack",
  iconUrl: null,
  versionId: "V9",
  versionLabel: "1.0",
  gameVersion: "1.20.1",
  loader: "fabric",
};

describe("renderModEnv", () => {
  it("pins enabled entries and leaves disabled ones out", () => {
    const r = renderModEnv(
      MODS,
      [
        { source: "modrinth", projectId: "AA", versionId: "v1", enabled: true },
        { source: "modrinth", projectId: "BB", versionId: "v2", enabled: false },
        { source: "curseforge", projectId: "123", versionId: "456", enabled: true },
      ],
      null,
      { curseforge: null },
    );
    expect(r.env).toEqual({ MODRINTH_PROJECTS: "AA:v1", CURSEFORGE_FILES: "123:456" });
    expect(r.secretKeys).toEqual([]);
  });

  it("always emits every source var, even empty, so the image removes old mods", () => {
    const r = renderModEnv(MODS, [], null, { curseforge: null });
    expect(r.env).toEqual({ MODRINTH_PROJECTS: "", CURSEFORGE_FILES: "" });
  });

  it("downloads every Workshop item but enables only the enabled ones", () => {
    const r = renderModEnv(
      STEAM,
      [
        { source: "steam-workshop", projectId: "11", versionId: null, enabled: true },
        { source: "steam-workshop", projectId: "22", versionId: null, enabled: false },
      ],
      null,
      { curseforge: null },
    );
    expect(r.env).toEqual({ TMOD_AUTODOWNLOAD: "11,22", TMOD_ENABLEDMODS: "11" });
  });

  it("adds the modpack env and marks the CurseForge key secret", () => {
    const r = renderModEnv(MODS, [], PACK, { curseforge: "KEY" });
    expect(r.env).toMatchObject({
      TYPE: "MODRINTH",
      MODRINTH_MODPACK: "P1",
      MODRINTH_VERSION: "V9",
      VERSION: "1.20.1",
      CF_API_KEY: "KEY",
    });
    expect(r.secretKeys).toEqual(["CF_API_KEY"]);
    expect(snapshotModEnv(r)).not.toHaveProperty("CF_API_KEY");
  });

  it("renders nothing for a game without mods", () => {
    expect(renderModEnv(undefined, [], null, { curseforge: "K" })).toEqual({
      env: {},
      secretKeys: [],
    });
  });
});

describe("pending and destructive changes", () => {
  it("treats empty values like absent ones", () => {
    const r = renderModEnv(MODS, [], null, { curseforge: null });
    expect(modEnvPending(r, null)).toBe(false);
    expect(modEnvPending(r, {})).toBe(false);
  });

  it("is pending when the list changed", () => {
    const r = renderModEnv(
      MODS,
      [{ source: "modrinth", projectId: "AA", versionId: "v1", enabled: true }],
      null,
      { curseforge: null },
    );
    expect(modEnvPending(r, { MODRINTH_PROJECTS: "" })).toBe(true);
    expect(modEnvPending(r, { MODRINTH_PROJECTS: "AA:v1", CURSEFORGE_FILES: "" })).toBe(false);
  });

  it("is not pending just because a CurseForge key was added", () => {
    const r = renderModEnv(MODS, [], null, { curseforge: "KEY" });
    expect(modEnvPending(r, {})).toBe(false);
  });

  it("is destructive when a project disappears or the modpack changes", () => {
    expect(
      isDestructiveChange(
        { MODRINTH_PROJECTS: "AA:v1,BB:v2" },
        { MODRINTH_PROJECTS: "AA:v1" },
        MODS,
      ),
    ).toBe(true);
    expect(
      isDestructiveChange({ MODRINTH_PROJECTS: "AA:v1" }, { MODRINTH_PROJECTS: "AA:v2,BB:v1" }, MODS),
    ).toBe(false);
    expect(isDestructiveChange({ MODRINTH_MODPACK: "P1" }, { MODRINTH_MODPACK: "P2" }, MODS)).toBe(
      true,
    );
    expect(isDestructiveChange(null, { MODRINTH_PROJECTS: "AA:v1" }, MODS)).toBe(false);
    expect(
      isDestructiveChange({ TMOD_ENABLEDMODS: "11,22" }, { TMOD_ENABLEDMODS: "11" }, STEAM),
    ).toBe(true);
  });
});

describe("compatFilter", () => {
  const spec = {
    mods: MODS,
    variables: [{ key: "server_type", label: "Server type" }] as any[],
  };

  it("maps the loader select and leaves aliases to be resolved", () => {
    expect(compatFilter(spec, { server_type: "FABRIC", mc_version: "LATEST" }, null)).toEqual({
      loaders: ["fabric"],
      kind: "mod",
      gameVersion: null,
      versionAlias: "release",
      unsupported: null,
    });
    expect(
      compatFilter(spec, { server_type: "PAPER", mc_version: "1.21.4" }, null),
    ).toMatchObject({
      loaders: ["paper", "bukkit", "spigot"],
      kind: "plugin",
      gameVersion: "1.21.4",
      versionAlias: null,
    });
  });

  it("explains when the current loader has no mods", () => {
    const c = compatFilter(spec, { server_type: "VANILLA", mc_version: "1.21.4" }, null);
    expect(c.unsupported).toMatch(/Server type/);
    expect(c.unsupported).toMatch(/FABRIC, PAPER/);
  });

  it("takes loader and version from the modpack when one is set", () => {
    expect(compatFilter(spec, { server_type: "VANILLA", mc_version: "LATEST" }, PACK)).toEqual({
      loaders: ["fabric"],
      kind: "mod",
      gameVersion: "1.20.1",
      versionAlias: null,
      unsupported: null,
    });
  });

  it("has no filter for a game without loader/version (Workshop)", () => {
    expect(compatFilter({ mods: STEAM, variables: [] }, {}, null)).toEqual({
      loaders: null,
      kind: null,
      gameVersion: null,
      versionAlias: null,
      unsupported: null,
    });
  });
});

describe("mayApplyMods (the worker's gate)", () => {
  const applied = { MODRINTH_PROJECTS: "AA:v1,BB:v2", CURSEFORGE_FILES: "" };
  const adding = { MODRINTH_PROJECTS: "AA:v1,BB:v2,CC:v3", CURSEFORGE_FILES: "" };
  const removing = { MODRINTH_PROJECTS: "AA:v1", CURSEFORGE_FILES: "" };

  it("lets a non-destructive change through without a backup", () => {
    expect(mayApplyMods(applied, adding, MODS, null)).toEqual({ ok: true });
  });

  it("refuses a destructive change that came without a backup", () => {
    // Queued as an add, then a mod was removed before the job ran.
    const r = mayApplyMods(applied, removing, MODS, null);
    expect(r.ok).toBe(false);
  });

  it("refuses a destructive change whose safety backup failed", () => {
    const r = mayApplyMods(applied, removing, MODS, { status: "failed", error: "tar failed (2)" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/backup/i);
  });

  it("allows it once the safety backup succeeded", () => {
    expect(mayApplyMods(applied, removing, MODS, { status: "success", error: null })).toEqual({
      ok: true,
    });
  });

  it("allows it when there was no world to back up yet", () => {
    expect(
      mayApplyMods(applied, removing, MODS, {
        status: "failed",
        error: "Nothing to back up yet: the server has not written its world",
      }),
    ).toEqual({ ok: true });
  });
});

describe("modEnvForProvision", () => {
  const rendered = {
    env: { MODRINTH_PROJECTS: "AA:v1,ZZ:v9", CF_API_KEY: "NEWKEY" },
    secretKeys: ["CF_API_KEY"],
  };

  it("renders the current list when applying mods", () => {
    expect(modEnvForProvision(rendered, { MODRINTH_PROJECTS: "AA:v1" }, "current")).toEqual(
      rendered.env,
    );
  });

  it("keeps the applied list (with live keys) for any other rebuild", () => {
    expect(modEnvForProvision(rendered, { MODRINTH_PROJECTS: "AA:v1" }, "applied")).toEqual({
      MODRINTH_PROJECTS: "AA:v1",
      CF_API_KEY: "NEWKEY",
    });
  });

  it("falls back to the current list for a server never provisioned", () => {
    expect(modEnvForProvision(rendered, null, "applied")).toEqual(rendered.env);
  });
});
