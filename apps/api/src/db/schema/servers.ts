import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  bigint,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { sshKeys } from "./ssh-keys";
import { databases } from "./databases";
import { applications } from "./applications";

const servers = pgTable("servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").default(22).notNull(),
  username: varchar("username", { length: 100 }).default("root").notNull(),
  sshKeyId: uuid("ssh_key_id").references(() => sshKeys.id, {
    onDelete: "restrict",
  }),
  isLocal: boolean("is_local").default(false).notNull(),
  // Status
  status: varchar("status", { length: 20 }).default("disconnected").notNull(),
  lastHealthCheck: timestamp("last_health_check"),
  // Docker info (populated by health check)
  dockerVersion: varchar("docker_version", { length: 50 }),
  // Resources (updated by health checks)
  totalCpu: integer("total_cpu"),
  totalMemory: bigint("total_memory", { mode: "number" }),
  totalDisk: bigint("total_disk", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const serverRelations = relations(servers, ({ one, many }) => ({
  applications: many(applications),
  databases: many(databases),
  sshKey: one(sshKeys, {
    fields: [servers.sshKeyId],
    references: [sshKeys.id],
  }),
}));

type ServerT = typeof servers.$inferSelect;
type NewServerT = typeof servers.$inferInsert;

export { servers, serverRelations, type ServerT, type NewServerT };
