import { describe, it, expect, vi } from "vitest";

import { joinOwnContainer } from "./docker";

/**
 * Game servers live on their own network, so the API has to join it to reach
 * RCON. In production the API is itself a container; in development it runs
 * on the host and there is nothing to join.
 */

const fakeDocker = (inspect: () => Promise<unknown>) => {
  const connect = vi.fn(async () => {});
  return {
    connect,
    client: {
      getContainer: vi.fn(() => ({ inspect })),
      getNetwork: vi.fn(() => ({ connect })),
    } as any,
  };
};

describe("joinOwnContainer", () => {
  it("does nothing when the API is not running in a container", async () => {
    const { client, connect } = fakeDocker(async () => {
      throw Object.assign(new Error("no such container"), { statusCode: 404 });
    });
    expect(await joinOwnContainer("deploykit-games", client, "my-laptop")).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it("connects its own container to the network", async () => {
    const { client, connect } = fakeDocker(async () => ({
      Id: "abc123",
      NetworkSettings: { Networks: { "deploykit-network": {} } },
    }));
    expect(await joinOwnContainer("deploykit-games", client, "abc123")).toBe(true);
    expect(client.getNetwork).toHaveBeenCalledWith("deploykit-games");
    expect(connect).toHaveBeenCalledWith({ Container: "abc123" });
  });

  it("leaves it alone when it is already on the network", async () => {
    const { client, connect } = fakeDocker(async () => ({
      Id: "abc123",
      NetworkSettings: { Networks: { "deploykit-games": {} } },
    }));
    expect(await joinOwnContainer("deploykit-games", client, "abc123")).toBe(true);
    expect(connect).not.toHaveBeenCalled();
  });
});
