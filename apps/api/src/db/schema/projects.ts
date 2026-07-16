import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { databases } from "./databases";
import { applications } from "./applications";
import { projectMembers } from "./project-members";
import { notificationChannels } from "./notification-channels";

const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Public status page (opt-in). When enabled, /status/{slug} is reachable
  // without auth and lists apps flagged status_page_visible.
  statusPageEnabled: boolean("status_page_enabled").default(false).notNull(),
  statusPageSlug: varchar("status_page_slug", { length: 80 }),
  statusPageTitle: varchar("status_page_title", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const projectRelations = relations(projects, ({ many }) => ({
  applications: many(applications),
  databases: many(databases),
  notificationChannels: many(notificationChannels),
  members: many(projectMembers),
}));

type ProjectT = typeof projects.$inferSelect;
type NewProjectT = typeof projects.$inferInsert;

export { projects, projectRelations, type ProjectT, type NewProjectT };
