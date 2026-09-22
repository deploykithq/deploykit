import { describe, it, expect } from "vitest";

import { createOutputTail } from "./output-tail";

describe("createOutputTail", () => {
  it("keeps everything while under the cap", () => {
    const tail = createOutputTail(100);
    tail.push("hello ");
    tail.push("world");
    expect(tail.value()).toBe("hello world");
    expect(tail.truncated()).toBe(false);
  });

  it("keeps the tail, not the head, once over the cap", () => {
    const tail = createOutputTail(10);
    tail.push("0123456789");
    tail.push("abcde");
    expect(tail.value()).toBe("56789abcde");
    expect(tail.truncated()).toBe(true);
  });

  it("never splits a multi-byte character", () => {
    const tail = createOutputTail(5);
    // "é" is 2 bytes in UTF-8; cutting mid-character would yield U+FFFD.
    tail.push("ééééé");
    expect(tail.value()).not.toContain("�");
    expect(tail.truncated()).toBe(true);
  });
});
