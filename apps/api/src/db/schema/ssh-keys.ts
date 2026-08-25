import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { users } from "./users";
import { servers } from "./servers";

const sshKeys = pgTable(
  "ssh_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: varchar("description", { length: 500 }),
    // "rsa" | "ed25519" — always derived from the key material, never from input
    type: varchar("type", { length: 20 }).notNull(),
    publicKey: text("public_key").notNull(),
    privateKey: text("private_key").notNull(), // encrypted (AES-256-GCM)
    fingerprint: varchar("fingerprint", { length: 100 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("ssh_keys_fingerprint_idx").on(table.fingerprint)],
);

const sshKeyRelations = relations(sshKeys, ({ many }) => ({
  servers: many(servers),
}));

type SshKeyT = typeof sshKeys.$inferSelect;
type NewSshKeyT = typeof sshKeys.$inferInsert;

export { sshKeys, sshKeyRelations, type SshKeyT, type NewSshKeyT };
