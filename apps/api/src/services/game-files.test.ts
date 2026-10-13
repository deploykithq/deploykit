import { describe, it, expect, vi } from "vitest";

import { gameSpecSchema } from "@deploykit/shared";

/**
 * Path handling of the game server file manager. Everything runs inside a
 * helper container, but a path still must never leave the volume it names.
 */

vi.mock("../db/index", () => ({ db: {} }));
vi.mock("../lib/docker", () => ({ docker: {} }));
vi.mock("../lib/socket", () => ({ emitServiceStatus: vi.fn(), emitContainerLog: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: {} }));
vi.mock("./docker-factory", () => ({ getDockerForServer: vi.fn() }));

const { resolveSafePath, parseStatLines, assertFileName, GameFilesError } = await import(
  "./game-files"
);

const row = {
  spec: gameSpecSchema.parse({
    id: "g",
    name: "G",
    version: "1",
    description: "d",
    image: "example/g:1",
    ports: [{ name: "game", protocol: "tcp", container: 1 }],
    volumes: [
      { name: "data", path: "/data", primary: true },
      { name: "server", path: "/opt/server", browsable: false, backup: false },
    ],
  }),
};

describe("resolveSafePath", () => {
  it("maps a relative path into the volume's mount", () => {
    expect(resolveSafePath(row, "data", "world/level.dat")).toBe("/mnt/data/world/level.dat");
    expect(resolveSafePath(row, "data", "/plugins/")).toBe("/mnt/data/plugins");
  });

  it("treats an empty path and '.' as the volume root", () => {
    expect(resolveSafePath(row, "data", "")).toBe("/mnt/data");
    expect(resolveSafePath(row, "data", ".")).toBe("/mnt/data");
  });

  it.each([
    ["../../etc/passwd"],
    ["world/../../server"],
    [".."],
    ["a\\b"],
    ["a\0b"],
    ["x".repeat(1025)],
  ])("rejects %j", (bad) => {
    expect(() => resolveSafePath(row, "data", bad)).toThrow(GameFilesError);
  });

  it("does not resolve an absolute path outside the volume", () => {
    expect(resolveSafePath(row, "data", "/etc/passwd")).toBe("/mnt/data/etc/passwd");
  });

  it("refuses a volume that is not browsable, or unknown", () => {
    expect(() => resolveSafePath(row, "server", "")).toThrow("No such volume");
    expect(() => resolveSafePath(row, "nope", "")).toThrow("No such volume");
  });
});

describe("assertFileName", () => {
  it.each([[""], ["."], [".."], ["a/b"], ["a\\b"], ["x".repeat(256)]])("rejects %j", (bad) => {
    expect(() => assertFileName(bad)).toThrow(GameFilesError);
  });

  it("accepts an ordinary name", () => {
    expect(() => assertFileName("EssentialsX-2.20.jar")).not.toThrow();
  });
});

describe("parseStatLines", () => {
  it("parses entries, folders first, and keeps tabs inside names", () => {
    const output = [
      "regular file\t120\t1700000000\t/mnt/data/server.properties",
      "directory\t4096\t1700000100\t/mnt/data/world",
      "regular empty file\t0\t1700000200\t/mnt/data/odd\tname.txt",
      "symbolic link\t9\t1700000300\t/mnt/data/link",
      "garbage line",
      "",
    ].join("\n");

    expect(parseStatLines(output)).toEqual([
      { name: "world", type: "directory", size: 4096, modifiedAt: "2023-11-14T22:15:00.000Z" },
      { name: "link", type: "symlink", size: 9, modifiedAt: "2023-11-14T22:18:20.000Z" },
      { name: "odd\tname.txt", type: "file", size: 0, modifiedAt: "2023-11-14T22:16:40.000Z" },
      { name: "server.properties", type: "file", size: 120, modifiedAt: "2023-11-14T22:13:20.000Z" },
    ]);
  });
});
