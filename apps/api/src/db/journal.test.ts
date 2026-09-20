import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, it, expect, afterEach } from "vitest";

import { assertJournalIsApplicable } from "./journal";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "migrations");

const folders: string[] = [];

/** Writes a throwaway migrations folder from `[when, tag]` pairs. */
const journalFolder = (
  entries: [number, string][],
  opts: { skipFiles?: string[] } = {},
): string => {
  const folder = mkdtempSync(join(tmpdir(), "dk-journal-"));
  folders.push(folder);
  mkdirSync(join(folder, "meta"));

  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: entries.map(([when, tag], idx) => ({
        idx,
        version: "7",
        when,
        tag,
        breakpoints: true,
      })),
    }),
  );

  for (const [, tag] of entries) {
    if (!opts.skipFiles?.includes(tag)) {
      writeFileSync(join(folder, `${tag}.sql`), "SELECT 1;");
    }
  }

  return folder;
};

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("assertJournalIsApplicable", () => {
  it("accepts the journal this repository ships", () => {
    expect(() => assertJournalIsApplicable(MIGRATIONS_FOLDER)).not.toThrow();
  });

  it("accepts strictly increasing timestamps", () => {
    const folder = journalFolder([
      [1000, "0000_first"],
      [2000, "0001_second"],
      [3000, "0002_third"],
    ]);

    expect(() => assertJournalIsApplicable(folder)).not.toThrow();
  });

  it("rejects an entry that would be skipped in silence", () => {
    const folder = journalFolder([
      [3000, "0000_first"],
      [1000, "0001_never_applied"],
    ]);

    expect(() => assertJournalIsApplicable(folder)).toThrow(
      /0001_never_applied.*not greater than.*0000_first/s,
    );
  });

  it("rejects a duplicated timestamp, which is skipped just the same", () => {
    const folder = journalFolder([
      [1000, "0000_first"],
      [1000, "0001_collides"],
    ]);

    expect(() => assertJournalIsApplicable(folder)).toThrow(/0001_collides/);
  });

  it("rejects a journal entry with no SQL file", () => {
    const folder = journalFolder(
      [
        [1000, "0000_first"],
        [2000, "0001_ghost"],
      ],
      { skipFiles: ["0001_ghost"] },
    );

    expect(() => assertJournalIsApplicable(folder)).toThrow(
      /0001_ghost\.sql is\s+missing/,
    );
  });
});
