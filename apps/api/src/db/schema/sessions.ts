import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { users } from "./users";

const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // sha256 hex of the refresh token — the raw token is never persisted,
    // and this doubles as the Redis whitelist key suffix.
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    ip: varchar("ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
    // Slides forward on every refresh so it stays in step with the Redis TTL
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

const sessionRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

type SessionT = typeof sessions.$inferSelect;
type NewSessionT = typeof sessions.$inferInsert;

export { sessions, sessionRelations, type SessionT, type NewSessionT };
