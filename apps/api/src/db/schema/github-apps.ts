import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { users } from "./users";
import { githubInstallations } from "./github-installations";

/**
 * The GitHub App this DeployKit instance owns.
 *
 * Normally exactly one row: a self-hosted install registers its own App
 * (through the manifest flow) rather than sharing a central one, because the
 * App's webhook has to reach this instance. The table allows more than one so a
 * future GitHub Enterprise Server App can sit beside the github.com one — which
 * is also why the base URLs are columns and not constants.
 *
 * privateKey, webhookSecret and clientSecret hold AES-256-GCM blobs
 * (lib/encryption.ts). The private key is the most sensitive secret in the
 * system: it can mint a token for every repository the App is installed on.
 */
const githubApps = pgTable(
  "github_apps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // GitHub's own numeric App id — the `iss` of every App JWT we sign
    appId: integer("app_id").notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    ownerLogin: varchar("owner_login", { length: 255 }),
    htmlUrl: varchar("html_url", { length: 500 }),
    clientId: varchar("client_id", { length: 100 }),
    clientSecret: text("client_secret"), // encrypted (AES-256-GCM)
    privateKey: text("private_key").notNull(), // encrypted PEM (AES-256-GCM)
    webhookSecret: text("webhook_secret").notNull(), // encrypted (AES-256-GCM)
    apiBaseUrl: varchar("api_base_url", { length: 255 })
      .default("https://api.github.com")
      .notNull(),
    webBaseUrl: varchar("web_base_url", { length: 255 })
      .default("https://github.com")
      .notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("github_apps_app_id_idx").on(table.appId)],
);

const githubAppRelations = relations(githubApps, ({ many }) => ({
  installations: many(githubInstallations),
}));

type GithubAppT = typeof githubApps.$inferSelect;
type NewGithubAppT = typeof githubApps.$inferInsert;

export {
  githubApps,
  githubAppRelations,
  type GithubAppT,
  type NewGithubAppT,
};
