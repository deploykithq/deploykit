import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { users } from "./users";
import { projects } from "./projects";

const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // Per-project role override: admin | operator | viewer
    role: varchar("role", { length: 20 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("project_members_unique_idx").on(t.projectId, t.userId),
    index("project_members_user_idx").on(t.userId),
  ],
);

const projectMemberRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));

type ProjectMemberT = typeof projectMembers.$inferSelect;
type NewProjectMemberT = typeof projectMembers.$inferInsert;

export {
  projectMembers,
  projectMemberRelations,
  type ProjectMemberT,
  type NewProjectMemberT,
};
