import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regenerating a world: which paths it deletes (and how), which spec it
 * trusts for a server created before its game declared a world, and when
 * the safety backup lets it go ahead.
 */

const getGame = vi.fn();
const execIn = vi.fn();

vi.mock("./game-catalog", () => ({ getGame: (id: string) => getGame(id) }));
vi.mock("./game-files", () => ({
  MOUNT_ROOT: "/mnt",
  execIn: (c: unknown, cmd: string[]) => execIn(c, cmd),
}));
vi.mock("./game-server", () => {
  class GameServerError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    GameServerError,
    allValues: (row: any) => ({ ...row.config }),
  };
});

const { worldFor, worldInfo, checkWorldValues, mayRegenerate, clearWorld } = await import(
  "./game-world"
);

const WORLD = { volume: "data", paths: ["tModLoader/Worlds"], variables: ["seed", "world_size"] };
const VARIABLES = [
  { key: "world_name", label: "World name", type: "string", editable: false },
  { key: "seed", label: "World seed", type: "string", editable: false, maxLength: 64 },
  {
    key: "world_size",
    label: "World size",
    type: "select",
    editable: false,
    options: [
      { label: "Small", value: "1" },
      { label: "Medium", value: "2" },
    ],
  },
  { key: "password", label: "Password", type: "string", secret: true },
];
const SPEC: any = {
  contract: 1,
  volumes: [{ name: "data" }, { name: "server" }],
  variables: VARIABLES,
};
const row = (spec: any = SPEC): any => ({
  gameId: "terraria-tmodloader",
  spec,
  config: { seed: "old", world_size: "2" },
  secretConfig: null,
});

beforeEach(() => {
  getGame.mockReset();
  execIn.mockReset();
});

describe("worldFor", () => {
  it("prefers the server's own snapshot", async () => {
    expect(await worldFor(row({ ...SPEC, world: WORLD }))).toEqual(WORLD);
    expect(getGame).not.toHaveBeenCalled();
  });

  it("falls back to the catalogue for the same contract, keeping what fits", async () => {
    getGame.mockResolvedValue({
      contract: 1,
      world: { ...WORLD, variables: ["seed", "difficulty", "password"] },
    });
    expect(await worldFor(row())).toEqual({ ...WORLD, variables: ["seed"] });
  });

  it("never trusts the catalogue across contracts or volumes", async () => {
    getGame.mockResolvedValue({ contract: 1, world: WORLD });
    expect(await worldFor(row({ ...SPEC, contract: undefined }))).toBeNull();
    getGame.mockResolvedValue({ contract: 1, world: { ...WORLD, volume: "saves" } });
    expect(await worldFor(row())).toBeNull();
    getGame.mockRejectedValue(new Error("registry down"));
    expect(await worldFor(row())).toBeNull();
  });
});

describe("worldInfo", () => {
  it("returns the creation variables with their current values", async () => {
    const info = await worldInfo(row({ ...SPEC, world: WORLD }));
    expect(info).toMatchObject({ available: true, paths: ["tModLoader/Worlds"] });
    expect(info.available && info.variables.map((v) => v.key)).toEqual(["seed", "world_size"]);
    expect(info.available && info.values).toEqual({ seed: "old", world_size: "2" });
  });

  it("explains a game without a world", async () => {
    getGame.mockResolvedValue(null);
    expect(await worldInfo(row())).toMatchObject({ available: false });
  });
});

describe("checkWorldValues", () => {
  it("validates against the variable definitions", () => {
    expect(checkWorldValues(SPEC, WORLD, { seed: "", world_size: "1" }, {})).toEqual({
      seed: "",
      world_size: "1",
    });
    expect(() => checkWorldValues(SPEC, WORLD, { world_size: "9" }, {})).toThrow(/World size/);
    expect(() => checkWorldValues(SPEC, WORLD, { world_name: "x" }, {})).toThrow(
      /Unknown setting/,
    );
  });
});

describe("mayRegenerate", () => {
  it("needs a safety backup that worked or found no world", () => {
    expect(mayRegenerate({ status: "success", error: null })).toEqual({ ok: true });
    expect(
      mayRegenerate({ status: "failed", error: "Nothing to back up yet: the server has not written its world" }),
    ).toEqual({ ok: true });
    expect(mayRegenerate({ status: "failed", error: "disk full" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("disk full"),
    });
    expect(mayRegenerate(null)).toMatchObject({ ok: false });
  });
});

describe("clearWorld", () => {
  it("empties a directory and removes a file, never the volume itself", async () => {
    execIn.mockImplementation(async (_c: unknown, cmd: string[]) => ({
      exitCode: cmd[0] === "test" ? (cmd[2]!.endsWith("Worlds") ? 0 : 1) : 0,
      stdout: "",
      stderr: "",
    }));
    await clearWorld({} as any, { volume: "data", paths: ["tModLoader/Worlds", "level.dat"], variables: [] });
    const run = execIn.mock.calls.map((c) => c[1]).filter((cmd) => cmd[0] !== "test");
    expect(run).toEqual([
      ["find", "/mnt/data/tModLoader/Worlds", "-mindepth", "1", "-delete"],
      ["rm", "-f", "--", "/mnt/data/level.dat"],
    ]);
  });

  it("refuses a path that escapes the volume", async () => {
    await expect(
      clearWorld({} as any, { volume: "data", paths: ["../server"], variables: [] }),
    ).rejects.toThrow(/outside the volume/);
    expect(execIn).not.toHaveBeenCalled();
  });

  it("fails loudly when deleting fails", async () => {
    execIn.mockImplementation(async (_c: unknown, cmd: string[]) => ({
      exitCode: cmd[0] === "test" ? 0 : 1,
      stdout: "",
      stderr: "Permission denied",
    }));
    await expect(clearWorld({} as any, WORLD)).rejects.toThrow(/Permission denied/);
  });
});
