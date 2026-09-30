import { describe, it, expect, vi, beforeEach } from "vitest";

const createAndStart = vi.fn();
const stopAndRemove = vi.fn();

vi.mock("./docker-factory", () => ({
  getDockerForServer: async () => ({
    docker: { createAndStart, stopAndRemove },
    isRemote: false,
  }),
}));

import {
  enableMaintenance,
  disableMaintenance,
  syncMaintenance,
  renderMaintenancePage,
} from "./maintenance";

const app = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "blog",
  serverId: null,
  maintenanceMessage: null,
};

beforeEach(() => {
  createAndStart.mockReset();
  stopAndRemove.mockReset();
});

describe("renderMaintenancePage", () => {
  it("escapes the app name and the message", () => {
    const html = renderMaintenancePage("<b>x</b>", "<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("falls back to a default text without a message", () => {
    const html = renderMaintenancePage("blog", "  ");
    expect(html).toContain("planned maintenance");
    expect(html).not.toContain('class="note"');
  });
});

describe("enableMaintenance", () => {
  it("routes every domain to a non-replica container at high priority", async () => {
    await enableMaintenance(app, [
      { domain: "blog.example.com", https: true },
      { domain: "www.example.com", https: false },
    ]);
    const opts = createAndStart.mock.calls[0]![0];
    expect(opts.name).toBe(`dk-maint-${app.id}`);
    expect(opts.ports).toBeUndefined();
    expect(opts.networkName).toBe("deploykit-network");
    expect(opts.labels["deploykit.service"]).toBeUndefined();
    expect(opts.labels["deploykit.maintenance"]).toBe(app.id);
    const r = `dk-maint-${app.id}`;
    expect(opts.labels[`traefik.http.routers.${r}.rule`]).toBe(
      "Host(`blog.example.com`)",
    );
    expect(opts.labels[`traefik.http.routers.${r}.priority`]).toBe("10000");
    expect(opts.labels[`traefik.http.routers.${r}-1.priority`]).toBe("10000");
    expect(opts.labels[`traefik.http.services.${r}.loadbalancer.server.port`]).toBe(
      "80",
    );
    const html = opts.env
      .find((e: string) => e.startsWith("DK_MAINT_HTML_B64="))
      .split("=")[1];
    expect(Buffer.from(html, "base64").toString()).toContain("blog");
  });

  it("refuses an app without domains", async () => {
    await expect(enableMaintenance(app, [])).rejects.toThrow(/no domains/);
    expect(createAndStart).not.toHaveBeenCalled();
  });
});

describe("disableMaintenance / syncMaintenance", () => {
  it("tolerates a container that no longer exists", async () => {
    stopAndRemove.mockRejectedValue(new Error("(HTTP code 404) no such container"));
    await expect(disableMaintenance(app)).resolves.toBeUndefined();
  });

  it("does nothing while maintenance is off", async () => {
    await syncMaintenance({ ...app, maintenanceEnabled: false }, [
      { domain: "blog.example.com", https: true },
    ]);
    expect(createAndStart).not.toHaveBeenCalled();
    expect(stopAndRemove).not.toHaveBeenCalled();
  });

  it("removes the container once the last domain is gone", async () => {
    stopAndRemove.mockResolvedValue(undefined);
    await syncMaintenance({ ...app, maintenanceEnabled: true }, []);
    expect(stopAndRemove).toHaveBeenCalledWith(`dk-maint-${app.id}`);
  });
});
