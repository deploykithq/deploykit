import { docker } from "../lib/docker";
import { emitContainerLog } from "../lib/socket";
import { db } from "../db/index";
import { containerLogs, type NewContainerLogRowT } from "../db/schema/index";
import { redactSecrets } from "../lib/redact";

// Single-owner container log stream manager.
//
// The log collector (workers/log-collector.scheduler.ts) keeps one follow-stream
// open per running container, regardless of whether anyone is watching the UI —
// that's what makes logs persistent. Each demuxed line is (1) emitted live to the
// Socket.IO room (unchanged behaviour) and (2) buffered for batched persistence
// into the container_logs table (secrets redacted, timestamp prefix parsed out).
//
// To avoid duplicate streams (collector + UI subscription), this module is the
// sole owner: ensureLogStream() is idempotent, and persistence metadata can be
// attached/upgraded after the stream already exists.

interface StreamMeta {
  serviceId: string;
  /**
   * For a Compose stack the id is the stack's, not a container's: every
   * container in the stack persists its lines under the same serviceId, which
   * is what makes the stack's Logs tab a single stream.
   */
  serviceType: "application" | "database" | "compose";
}

// Track active log streams so we can clean them up.
const activeStreams = new Map<string, NodeJS.ReadableStream>();
// Persistence metadata per container (absent = live-only, no persistence).
const streamMeta = new Map<string, StreamMeta>();

const LINE_MAX = 8000; // cap a single persisted line at 8 KB
const LOG_BUFFER_MAX = Number(process.env.LOG_BUFFER_MAX) || 5000;

let logBuffer: NewContainerLogRowT[] = [];
let droppedSinceWarn = 0;

// Ensure a follow-stream exists for a container. If `meta` is provided, lines are
// persisted; calling again with meta upgrades a previously live-only stream.
const ensureLogStream = async (
  containerId: string,
  meta?: StreamMeta,
): Promise<void> => {
  if (meta) streamMeta.set(containerId, meta);

  // Don't create duplicate streams.
  if (activeStreams.has(containerId)) return;

  try {
    const container = docker.getContainer(containerId);
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: 50,
    });

    activeStreams.set(containerId, stream);

    stream.on("data", (chunk: Buffer) => {
      const frames = demuxChunk(chunk);
      for (const frame of frames) {
        if (!frame.text.trim()) continue;
        // Live tail: emit the raw line (with timestamp prefix) — unchanged.
        emitContainerLog(containerId, frame.text);

        // Persist (only if this container has persistence metadata).
        const m = streamMeta.get(containerId);
        if (m) {
          const { ts, text } = parseDockerLine(frame.text);
          bufferLog({
            serviceId: m.serviceId,
            serviceType: m.serviceType,
            containerId,
            stream: frame.stream,
            level: parseLogLevel(text),
            message: redactSecrets(text).slice(0, LINE_MAX),
            timestamp: ts,
          });
        }
      }
    });

    stream.on("end", () => {
      activeStreams.delete(containerId);
    });

    stream.on("error", () => {
      activeStreams.delete(containerId);
    });
  } catch (err) {
    console.error(`[logs] Failed to start stream for ${containerId}:`, err);
  }
};

// Stop streaming logs for a container and forget its persistence metadata.
const stopLogStream = (containerId: string): void => {
  const stream = activeStreams.get(containerId);
  if (stream) {
    (stream as any).destroy?.();
    activeStreams.delete(containerId);
  }
  streamMeta.delete(containerId);
};

// Container ids that currently have a live stream (collector uses this to reconcile).
const activeStreamIds = (): string[] => [...activeStreams.keys()];

// Whether a container's stream is owned by the collector (i.e. has persistence
// metadata). Used so a UI unsubscribe doesn't tear down a collected stream.
const isCollected = (containerId: string): boolean =>
  streamMeta.has(containerId);

const bufferLog = (row: NewContainerLogRowT): void => {
  if (logBuffer.length >= LOG_BUFFER_MAX) {
    // Backpressure: drop the oldest lines so a noisy container can't OOM us.
    logBuffer.shift();
    droppedSinceWarn++;
  }
  logBuffer.push(row);
};

// Flush buffered lines to the DB in chunks. Safe to call concurrently-ish:
// we swap the buffer out first so new lines accumulate while we insert.
const flushLogBuffer = async (): Promise<void> => {
  if (droppedSinceWarn > 0) {
    console.warn(
      `[logs] Dropped ${droppedSinceWarn} log line(s) due to buffer overflow (LOG_BUFFER_MAX=${LOG_BUFFER_MAX})`,
    );
    droppedSinceWarn = 0;
  }
  if (logBuffer.length === 0) return;

  const pending = logBuffer;
  logBuffer = [];

  const CHUNK = 1000;
  try {
    for (let i = 0; i < pending.length; i += CHUNK) {
      await db.insert(containerLogs).values(pending.slice(i, i + CHUNK));
    }
  } catch (err: any) {
    console.error("[logs] Failed to flush log buffer:", err.message);
    // Drop on failure rather than re-queue — avoids unbounded growth if the
    // DB is unhealthy; the live tail is unaffected.
  }
};

interface Frame {
  text: string;
  stream: "stdout" | "stderr";
}

// Demux a Docker multiplexed stream chunk into frames. The 8-byte header's first
// byte is the stream type (1=stdout, 2=stderr); bytes 4-7 are the payload size.
const demuxChunk = (chunk: Buffer): Frame[] => {
  const frames: Frame[] = [];
  let offset = 0;

  while (offset < chunk.length) {
    if (offset + 8 > chunk.length) {
      // Incomplete header, treat rest as raw text.
      frames.push({
        text: chunk.subarray(offset).toString("utf-8"),
        stream: "stdout",
      });
      break;
    }

    const streamType = chunk[offset] === 2 ? "stderr" : "stdout";
    const size = chunk.readUInt32BE(offset + 4);
    offset += 8;

    if (size === 0) continue;

    if (offset + size > chunk.length) {
      frames.push({
        text: chunk.subarray(offset).toString("utf-8"),
        stream: streamType,
      });
      break;
    }

    frames.push({
      text: chunk.subarray(offset, offset + size).toString("utf-8"),
      stream: streamType,
    });
    offset += size;
  }

  return frames;
};

// Split Docker's RFC3339 timestamp prefix from the log text. With timestamps:true
// each line looks like "2024-01-15T10:30:00.123456789Z the message".
const parseDockerLine = (line: string): { ts: Date; text: string } => {
  const trimmed = line.replace(/\r?\n$/, "");
  const sp = trimmed.indexOf(" ");
  if (sp > 0) {
    const maybeTs = trimmed.slice(0, sp);
    const parsed = new Date(maybeTs);
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(maybeTs) &&
      !isNaN(parsed.getTime())
    ) {
      return { ts: parsed, text: trimmed.slice(sp + 1) };
    }
  }
  return { ts: new Date(), text: trimmed };
};

// Best-effort severity detection from common log formats. Scans the start of the
// line for an ERROR/WARN/INFO/DEBUG/FATAL token.
const parseLogLevel = (text: string): string | null => {
  const head = text.slice(0, 80);
  if (/\b(fatal|panic)\b/i.test(head)) return "fatal";
  if (/\b(error|err)\b/i.test(head)) return "error";
  if (/\b(warn|warning)\b/i.test(head)) return "warn";
  if (/\b(debug|trace)\b/i.test(head)) return "debug";
  if (/\b(info|notice)\b/i.test(head)) return "info";
  return null;
};

export {
  ensureLogStream,
  stopLogStream,
  activeStreamIds,
  isCollected,
  flushLogBuffer,
  type StreamMeta,
};
