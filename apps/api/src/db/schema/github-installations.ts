import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { githubApps } from "./github-apps";
import { applications } from "./applications";

/**
 * One account (user or organization) that installed our GitHub App.
 *
 * An installation is the unit the API mints tokens against, so an application
 * points at a row here rather than storing a credential of its own.
 *
 * Every numeric id uses `mode: "number"`: tRPC serializes with plain JSON here
 * (no superjson), and a real BigInt would throw on the way out. GitHub's ids
 * are far below 2^53.
 */
const githubInstallations = pgTable(
  "github_installations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubAppId: uuid("github_app_id")
      .references(() => githubApps.id, { onDelete: "cascade" })
      .notNull(),
    // GitHub's own numeric installation id, used in every API path
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    accountLogin: varchar("account_login", { length: 255 }).notNull(),
    accountType: varchar("account_type", { length: 20 }), // "User" | "Organization"
    accountId: bigint("account_id", { mode: "number" }),
    // "all" | "selected" — surfaced so the UI can nudge towards "selected"
    repositorySelection: varchar("repository_selection", { length: 10 }),
    // Set while GitHub has the installation suspended; tokens fail meanwhile
    suspendedAt: timestamp("suspended_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("github_installations_app_install_idx").on(
      table.githubAppId,
      table.installationId,
    ),
  ],
);

const githubInstallationRelations = relations(
  githubInstallations,
  ({ one, many }) => ({
    githubApp: one(githubApps, {
      fields: [githubInstallations.githubAppId],
      references: [githubApps.id],
    }),
    applications: many(applications),
  }),
);

type GithubInstallationT = typeof githubInstallations.$inferSelect;
type NewGithubInstallationT = typeof githubInstallations.$inferInsert;

export {
  githubInstallations,
  githubInstallationRelations,
  type GithubInstallationT,
  type NewGithubInstallationT,
};
