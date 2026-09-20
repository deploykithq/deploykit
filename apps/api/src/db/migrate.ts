import { join, resolve } from "path";
import postgres from "postgres";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { backfillSshKeys } from "./backfill/ssh-keys.backfill";
import { assertJournalIsApplicable } from "./journal";

// Load .env from monorepo root
config({ path: resolve(import.meta.dirname, "../../../../.env") });

const main = async () => {
  const connectionString = process.env.DATABASE_URL!;
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  // Resolved from this file rather than the cwd, so it holds wherever the
  // migrator is started from.
  const migrationsFolder = join(import.meta.dirname, "migrations");

  // A journal entry whose `when` does not exceed the one before it is skipped
  // without an error, so this is checked before anything touches the database.
  assertJournalIsApplicable(migrationsFolder);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete.");

  // Data migrations that need application-level crypto, and so cannot be SQL.
  await backfillSshKeys(client);

  await client.end();
  process.exit(0);
};

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
