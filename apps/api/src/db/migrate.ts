import { resolve } from "path";
import postgres from "postgres";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { backfillSshKeys } from "./backfill/ssh-keys.backfill";

// Load .env from monorepo root
config({ path: resolve(import.meta.dirname, "../../../../.env") });

const main = async () => {
  const connectionString = process.env.DATABASE_URL!;
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
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
