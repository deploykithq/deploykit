import { describe, it, expect, vi } from "vitest";

/**
 * The throwaway helpers that touch a game server's volumes (file manager,
 * backups) are one-off containers: no deploykit.service label, no ports, no
 * network, never restarted — and hardened like the game container itself.
 */

const createContainer = vi.fn(async () => ({ start: vi.fn(async () => {}) }));
vi.mock("../db/index", () => ({ db: {} }));
vi.mock("../lib/docker", () => ({
  docker: {
    getContainer: () => ({
      inspect: async () => {
        throw new Error("no such container");
      },
    }),
    getImage: () => ({ inspect: async () => ({}) }),
    createContainer,
  },
}));
vi.mock("../lib/socket", () => ({ emitServiceStatus: vi.fn(), emitContainerLog: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: {} }));
vi.mock("./docker-factory", () => ({ getDockerForServer: vi.fn() }));

const { ensureHelper } = await import("./game-files");

describe("ensureHelper", () => {
  it("creates an isolated, hardened one-off container", async () => {
    await ensureHelper({ id: "srv-1", name: "vikings", spec: {} as any } as any, {
      name: "dk-gs-vikings_files",
      purpose: "files",
      readOnly: false,
      volumes: ["data"],
    });
    const opts = (createContainer.mock.calls[0] as any[])[0];
    expect(opts.Labels).not.toHaveProperty("deploykit.service");
    expect(opts).not.toHaveProperty("ExposedPorts");
    expect(opts.HostConfig).not.toHaveProperty("PortBindings");
    expect(opts.HostConfig.NetworkMode).toBe("none");
    expect(opts.HostConfig.RestartPolicy).toEqual({ Name: "no" });
    expect(opts.HostConfig.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(opts.HostConfig.CapDrop).toEqual(expect.arrayContaining(["NET_RAW", "MKNOD"]));
  });
});
