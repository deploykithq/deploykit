import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "stream";

/**
 * The `exec` console runs an image's own command injector (tModLoader's
 * `inject`) with the command as a single argv element — never through a
 * shell — and echoes the output into the log room like an RCON reply.
 */

const execCalls: any[] = [];
const emitted: string[] = [];

vi.mock("../lib/docker", () => ({
  docker: {
    getContainer: () => ({
      inspect: async () => ({ State: { Running: true } }),
      exec: async (opts: any) => {
        execCalls.push(opts);
        return {
          start: async () => {
            const s = new PassThrough();
            setImmediate(() => s.end(Buffer.from("ok\n")));
            return s;
          },
        };
      },
    }),
    modem: {
      // The real demuxer strips Docker's 8-byte frame headers; the fake
      // stream above carries no headers.
      demuxStream: (stream: NodeJS.ReadableStream, out: NodeJS.WritableStream) => {
        stream.on("data", (c: Buffer) => out.write(c));
      },
    },
  },
}));
vi.mock("../lib/socket", () => ({
  emitContainerLog: (_id: string, line: string) => emitted.push(line),
}));
vi.mock("../lib/encryption", () => ({ decryptEnvVars: () => ({}) }));

const { sendConsoleCommand } = await import("./game-console");

describe("exec console", () => {
  it("runs the injector with the command as one argv element", async () => {
    const reply = await sendConsoleCommand(
      {
        spec: { console: { method: "exec", command: ["inject"] } } as any,
        containerId: "c1",
        secretConfig: null,
      },
      'say "hi there"; rm -rf /',
    );
    // Bounded inside the container too: Docker cannot kill an exec, so a
    // hung injector would otherwise outlive our own timeout.
    expect(execCalls[0].Cmd).toEqual([
      "timeout",
      "-s",
      "KILL",
      "10",
      "inject",
      'say "hi there"; rm -rf /',
    ]);
    expect(reply).toBe("ok\n");
    expect(emitted[0]).toContain('> say "hi there"');
  });
});
