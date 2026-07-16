import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { servers } from "./servers";
import { projects } from "./projects";

const databases = pgTable("databases", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // postgresql, mongodb, redis, mysql, mariadb
  version: varchar("version", { length: 50 }),
  // Connection
  internalPort: integer("internal_port").notNull(),
  dbUser: varchar("db_user", { length: 100 }),
  dbPassword: text("db_password"), // encrypted
  databaseName: varchar("database_name", { length: 255 }),
  // Container state
  containerId: varchar("container_id", { length: 100 }),
  status: varchar("status", { length: 20 }).default("idle").notNull(),
  serverId: uuid("server_id").references(() => servers.id, {
    onDelete: "set null",
  }),
  // Replica set (MongoDB only)
  replicaSet: boolean("replica_set").default(false).notNull(),
  // Backup config
  backupEnabled: boolean("backup_enabled").default(false).notNull(),
  backupCron: varchar("backup_cron", { length: 100 }),
  backupRetention: integer("backup_retention").default(7).notNull(),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const databaseRelations = relations(databases, ({ one }) => ({
  project: one(projects, {
    fields: [databases.projectId],
    references: [projects.id],
  }),
  server: one(servers, {
    fields: [databases.serverId],
    references: [servers.id],
  }),
}));

type DatabaseT = typeof databases.$inferSelect;
type NewDatabaseT = typeof databases.$inferInsert;

export { databases, databaseRelations, type DatabaseT, type NewDatabaseT };
