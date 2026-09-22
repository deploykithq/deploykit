/**
 * A bounded accumulator for command output.
 *
 * Keeps the *tail*: a failing migration puts the stack trace at the end, so
 * the last bytes are the ones worth storing. Cutting is done on a Buffer and
 * then decoded with a streaming-safe decoder, so a multi-byte character that
 * straddles the cut is dropped rather than turned into U+FFFD.
 */

const OUTPUT_TAIL_MAX_BYTES = 64 * 1024;

interface OutputTailI {
  push(chunk: string): void;
  value(): string;
  truncated(): boolean;
}

const createOutputTail = (
  maxBytes: number = OUTPUT_TAIL_MAX_BYTES,
): OutputTailI => {
  let buffer = Buffer.alloc(0);
  let didTruncate = false;

  return {
    push(chunk: string): void {
      buffer = Buffer.concat([buffer, Buffer.from(chunk, "utf8")]);
      if (buffer.length > maxBytes) {
        buffer = buffer.subarray(buffer.length - maxBytes);
        didTruncate = true;
      }
    },
    value(): string {
      if (!didTruncate) return buffer.toString("utf8");
      // Drop a leading continuation byte sequence left by the cut.
      let start = 0;
      while (
        start < buffer.length &&
        (buffer[start]! & 0b1100_0000) === 0b1000_0000
      ) {
        start += 1;
      }
      return buffer.subarray(start).toString("utf8");
    },
    truncated(): boolean {
      return didTruncate;
    },
  };
};

export { createOutputTail, OUTPUT_TAIL_MAX_BYTES, type OutputTailI };
