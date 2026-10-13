import net from "net";

/**
 * A minimal RCON client (Source RCON protocol, which Minecraft also speaks).
 *
 * Every packet is `int32 size | int32 id | int32 type | body | \0\0`, little
 * endian, where `size` counts everything after itself. Authentication is a
 * type-3 packet answered by a type-2 packet whose id is ours, or -1 when the
 * password is wrong; a command is a type-2 packet answered by type-0 packets.
 *
 * The one real difference is the end of a long answer. Source splits replies
 * over 4096 bytes and gives no length, so after the command we send an empty
 * type-0 packet: the server answers packets in order, so its echo marks the
 * end. Minecraft does not reliably echo that packet, so there we stop after a
 * short idle gap instead.
 *
 * One connection per command: consoles are used by people, not at a rate
 * where keeping a socket open would matter.
 */

type RconProtocolT = "source" | "minecraft";

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

const AUTH_ID = 1;
const COMMAND_ID = 2;
const SENTINEL_ID = 3;

/** Stop reading a Minecraft reply after this much silence. */
const MINECRAFT_IDLE_MS = 150;
/** A reply longer than this is truncated: it is shown in a console, not stored. */
const MAX_RESPONSE_BYTES = 64 * 1024;

class RconError extends Error {
  constructor(
    message: string,
    readonly code: "AUTH" | "TIMEOUT" | "CONNECTION",
  ) {
    super(message);
    this.name = "RconError";
  }
}

const encodePacket = (id: number, type: number, body: string): Buffer => {
  const payload = Buffer.from(body, "utf8");
  const packet = Buffer.alloc(4 + 4 + 4 + payload.length + 2);
  packet.writeInt32LE(packet.length - 4, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  payload.copy(packet, 12);
  // The two trailing NULs are already zero from alloc.
  return packet;
};

interface PacketI {
  id: number;
  type: number;
  body: string;
}

/**
 * Split complete packets off the front of `buffer`.
 * @returns the packets and whatever partial packet is left over.
 */
const decodePackets = (buffer: Buffer): { packets: PacketI[]; rest: Buffer } => {
  const packets: PacketI[] = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const size = buffer.readInt32LE(offset);
    if (size < 10 || size > 1024 * 1024) {
      throw new RconError(`Malformed RCON packet (size ${size})`, "CONNECTION");
    }
    if (buffer.length - offset - 4 < size) break;

    const id = buffer.readInt32LE(offset + 4);
    const type = buffer.readInt32LE(offset + 8);
    const body = buffer.toString("utf8", offset + 12, offset + 4 + size - 2);
    packets.push({ id, type, body });
    offset += 4 + size;
  }

  return { packets, rest: buffer.subarray(offset) };
};

interface RconExecOptsI {
  host: string;
  port: number;
  password: string;
  protocol: RconProtocolT;
  command: string;
  timeoutMs?: number;
}

/** Run one command and return the server's reply. */
const rconExec = (opts: RconExecOptsI): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = net.connect({ host: opts.host, port: opts.port });
    let buffer: Buffer = Buffer.alloc(0);
    let authed = false;
    let response = "";
    let idleTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const finish = (err: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      if (idleTimer) clearTimeout(idleTimer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value!);
    };

    const overall = setTimeout(
      () =>
        authed && response
          ? finish(null, response) // a slow tail: return what arrived
          : finish(new RconError("RCON did not answer in time", "TIMEOUT")),
      opts.timeoutMs ?? 5_000,
    );

    const append = (body: string) => {
      if (response.length < MAX_RESPONSE_BYTES) {
        response = (response + body).slice(0, MAX_RESPONSE_BYTES);
      }
    };

    socket.on("connect", () => {
      socket.write(encodePacket(AUTH_ID, SERVERDATA_AUTH, opts.password));
    });

    socket.on("data", (chunk: Buffer) => {
      let packets: PacketI[];
      try {
        ({ packets, rest: buffer } = decodePackets(Buffer.concat([buffer, chunk])));
      } catch (err) {
        finish(err as Error);
        return;
      }

      for (const packet of packets) {
        if (!authed) {
          // Source sends an empty RESPONSE_VALUE before the auth answer.
          if (packet.type !== SERVERDATA_EXECCOMMAND) continue;
          if (packet.id === -1) {
            finish(new RconError("RCON authentication failed", "AUTH"));
            return;
          }
          authed = true;
          socket.write(encodePacket(COMMAND_ID, SERVERDATA_EXECCOMMAND, opts.command));
          if (opts.protocol === "source") {
            socket.write(encodePacket(SENTINEL_ID, SERVERDATA_RESPONSE_VALUE, ""));
          }
          continue;
        }

        if (packet.id === SENTINEL_ID) {
          finish(null, response);
          return;
        }
        if (packet.id === COMMAND_ID) {
          append(packet.body);
          if (opts.protocol === "minecraft") {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => finish(null, response), MINECRAFT_IDLE_MS);
          }
        }
      }
    });

    socket.on("error", (err) =>
      finish(new RconError(`RCON connection failed: ${err.message}`, "CONNECTION")),
    );
    socket.on("close", () => {
      if (authed) finish(null, response);
      else finish(new RconError("RCON connection closed before authenticating", "CONNECTION"));
    });
  });

export {
  rconExec,
  encodePacket,
  decodePackets,
  RconError,
  type RconProtocolT,
  type RconExecOptsI,
};
