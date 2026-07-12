import { config } from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root (needed because ESM hoists imports above dotenv in index.ts)
config({ path: resolve(import.meta.dirname, "../../../../.env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Check your .env file.");
}

const client = postgres(connectionString);
const db = drizzle(client, { schema });

type DB = typeof db;

export { db, type DB };
