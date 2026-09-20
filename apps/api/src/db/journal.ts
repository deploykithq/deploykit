import { readFileSync, existsSync } from "fs";
import { join } from "path";

interface JournalEntryI {
  idx: number;
  when: number;
  tag: string;
}

interface JournalI {
  entries: JournalEntryI[];
}

/**
 * Validates meta/_journal.json before a single statement runs.
 *
 * Drizzle applies a journal entry only when its `when` is greater than the newest
 * `created_at` in drizzle.__drizzle_migrations — `idx` and `tag` are never
 * consulted (see `migrate` in drizzle-orm/pg-core/dialect.js). An entry whose
 * `when` is lower than, or equal to, one that came before it is therefore skipped
 * **without any error**, and migrate() still reports "Migrations complete". That
 * is how a withdrawn migration with a far-future timestamp once gated out every
 * migration written after it.
 *
 * Failing here turns that silent data-loss-shaped bug into a startup error.
 */
export const assertJournalIsApplicable = (migrationsFolder: string): void => {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as JournalI;

  journal.entries.forEach((entry, index) => {
    const previous = journal.entries[index - 1];

    if (previous && entry.when <= previous.when) {
      throw new Error(
        `Migration journal out of order: "${entry.tag}" has when=${entry.when}, ` +
          `which is not greater than "${previous.tag}" (when=${previous.when}). ` +
          `Drizzle would skip it silently. Bump the "when" in meta/_journal.json ` +
          `above every entry before it.`,
      );
    }

    if (!existsSync(join(migrationsFolder, `${entry.tag}.sql`))) {
      throw new Error(
        `Migration journal references "${entry.tag}", but ${entry.tag}.sql is ` +
          `missing from ${migrationsFolder}.`,
      );
    }
  });
};
