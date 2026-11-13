import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { users } from "./users";

/**
 * Long-lived credentials for non-browser clients (the MCP server, scripts).
 * A token acts as its user; `scope` can only narrow what that user may do.
 * Only the SHA-256 of the token is stored — the value is shown once.
 */
const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    // First characters of the token, so a user can tell their tokens apart.
    tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
    scope: varchar("scope", { length: 10 }).default("read").notNull(), // read | write
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("api_tokens_token_hash_idx").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

const apiTokenRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id] }),
}));

type ApiTokenT = typeof apiTokens.$inferSelect;
type NewApiTokenT = typeof apiTokens.$inferInsert;

export { apiTokens, apiTokenRelations, type ApiTokenT, type NewApiTokenT };
