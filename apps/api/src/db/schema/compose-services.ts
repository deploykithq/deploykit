import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { servers } from "./servers";
import { projects } from "./projects";
import { composeDomains } from "./compose-domains";

/** A configuration file the stack needs on disk, written into the stack directory. */
interface ComposeMountI {
  filePath: string;
  content: string;
}

/**
 * A Compose stack: one `docker-compose.yml` deployed as a unit under the
 * Compose project name `dk-<name>`.
 *
 * Unlike `applications`, a stack has no single container, image or port — the
 * YAML owns all of that. What DeployKit tracks here is the source of the stack,
 * the values injected into it, and where it runs.
 */
const composeServices = pgTable("compose_services", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  // Source
  sourceType: varchar("source_type", { length: 20 })
    .default("template")
    .notNull(), // template | raw
  templateId: varchar("template_id", { length: 100 }),
  templateVersion: varchar("template_version", { length: 50 }),
  /** The Compose file as authored — labels and networks are injected at deploy time. */
  composeFile: text("compose_file").notNull(),
  /**
   * Encrypted `.env` contents (lib/encryption). Written next to the Compose
   * file at deploy time so Compose interpolates `${VAR}` from it.
   */
  envVars: text("env_vars"),
  mounts: jsonb("mounts").$type<ComposeMountI[]>(),
  // Server
  serverId: uuid("server_id").references(() => servers.id, {
    onDelete: "set null",
  }),
  // State
  status: varchar("status", { length: 20 }).default("idle").notNull(),
  statusPageVisible: boolean("status_page_visible").default(false).notNull(),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const composeServiceRelations = relations(
  composeServices,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [composeServices.projectId],
      references: [projects.id],
    }),
    server: one(servers, {
      fields: [composeServices.serverId],
      references: [servers.id],
    }),
    domains: many(composeDomains),
  }),
);

type ComposeServiceT = typeof composeServices.$inferSelect;
type NewComposeServiceT = typeof composeServices.$inferInsert;

export {
  composeServices,
  composeServiceRelations,
  type ComposeMountI,
  type ComposeServiceT,
  type NewComposeServiceT,
};
