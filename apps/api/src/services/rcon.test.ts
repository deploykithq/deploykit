import net from "net";
import { describe, it, expect, afterEach } from "vitest";

import { rconExec, encodePacket, decodePackets, RconError } from "./rcon";

/**
 * The RCON client against a fake server speaking the Source protocol, with
 * the two dialects' differences: Source splits long replies and mirrors the
 * end-of-reply sentinel, Minecraft does neither reliably.
 */

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

interface FakeOptsI {
  password: string;
  dialect: "source" | "minecraft";
  reply: (command: string) => string[];
  /** Source servers send an empty RESPONSE_VALUE before the auth answer. */
  preAuthEmpty?: boolean;
  silent?: boolean;
}

const fakeServer = (opts: FakeOptsI): Promise<number> =>
  new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0) as Buffer;
      socket.on("data", (chunk) => {
        const decoded = decodePackets(Buffer.concat([buffer, chunk]));
        buffer = decoded.rest;
        for (const packet of decoded.packets) {
          if (opts.silent) continue;
          if (packet.type === 3) {
            if (opts.preAuthEmpty) socket.write(encodePacket(packet.id, 0, ""));
            const ok = packet.body === opts.password;
            socket.write(encodePacket(ok ? packet.id : -1, 2, ""));
          } else if (packet.type === 2) {
            for (const part of opts.reply(packet.body)) {
              socket.write(encodePacket(packet.id, 0, part));
            }
          } else if (packet.type === 0 && opts.dialect === "source") {
            socket.write(encodePacket(packet.id, 0, ""));
          }
        }
      });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });

describe("packet codec", () => {
  it("round-trips a packet and keeps a partial one for later", () => {
    const a = encodePacket(7, 2, "list");
    const b = encodePacket(8, 0, "hello");
    const { packets, rest } = decodePackets(Buffer.concat([a, b.subarray(0, 5)]));
    expect(packets).toEqual([{ id: 7, type: 2, body: "list" }]);
    expect(rest.length).toBe(5);
  });

  it("rejects a nonsensical size instead of buffering forever", () => {
    const bad = Buffer.alloc(12);
    bad.writeInt32LE(5, 0);
    expect(() => decodePackets(bad)).toThrow(RconError);
  });
});

describe("rconExec", () => {
  it("runs a Minecraft command", async () => {
    const port = await fakeServer({
      password: "pw",
      dialect: "minecraft",
      reply: (cmd) => [`ran ${cmd}`],
    });
    await expect(
      rconExec({ host: "127.0.0.1", port, password: "pw", protocol: "minecraft", command: "list" }),
    ).resolves.toBe("ran list");
  });

  it("joins a Source reply split over several packets, ending at the sentinel", async () => {
    const port = await fakeServer({
      password: "pw",
      dialect: "source",
      preAuthEmpty: true,
      reply: () => ["part one, ", "part two"],
    });
    await expect(
      rconExec({ host: "127.0.0.1", port, password: "pw", protocol: "source", command: "status" }),
    ).resolves.toBe("part one, part two");
  });

  it("reports a wrong password as an authentication failure", async () => {
    const port = await fakeServer({ password: "pw", dialect: "source", reply: () => [] });
    await expect(
      rconExec({ host: "127.0.0.1", port, password: "nope", protocol: "source", command: "x" }),
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("times out on a server that never answers", async () => {
    const port = await fakeServer({ password: "pw", dialect: "source", reply: () => [], silent: true });
    await expect(
      rconExec({
        host: "127.0.0.1",
        port,
        password: "pw",
        protocol: "source",
        command: "x",
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("reports a refused connection", async () => {
    const port = await fakeServer({ password: "pw", dialect: "source", reply: () => [] });
    await new Promise((r) => servers.pop()!.close(r));
    await expect(
      rconExec({ host: "127.0.0.1", port, password: "pw", protocol: "source", command: "x" }),
    ).rejects.toMatchObject({ code: "CONNECTION" });
  });
});
