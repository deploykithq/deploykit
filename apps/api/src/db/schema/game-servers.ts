import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  text,
  jsonb,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import type { GameSpecT, ModSourceIdT } from "@deploykit/shared";

import { users } from "./users";
import { servers } from "./servers";
import { projects } from "./projects";

/** The modpack a server was built from (snapshotted when it was chosen). */
interface GameModpackI {
  source: ModSourceIdT;
  projectId: string;
  slug: string | null;
  name: string;
  iconUrl: string | null;
  versionId: string;
  versionLabel: string;
  gameVersion: string | null;
  loader: string | null;
}

/**
 * A game server: one container built from a game definition in the template
 * catalogue. `spec` is the definition as it was at creation — a snapshot, so a
 * registry edit never changes a running server.
 */
const gameServers = pgTable("game_servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  // Null = the local server. v1 refuses anything else.
  serverId: uuid("server_id").references(() => servers.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 41 }).notNull(),
  gameId: varchar("game_id", { length: 64 }).notNull(),
  gameName: varchar("game_name", { length: 100 }).notNull(),
  specVersion: varchar("spec_version", { length: 50 }).notNull(),
  spec: jsonb("spec").$type<GameSpecT>().notNull(),
  image: varchar("image", { length: 500 }).notNull(),
  // Values of the game's non-secret variables.
  config: jsonb("config").$type<Record<string, string>>().default({}).notNull(),
  // Values of its secret variables: encrypt(JSON.stringify(record)).
  secretConfig: text("secret_config"),
  memoryMb: integer("memory_mb").notNull(),
  cpuMillicores: integer("cpu_millicores"),
  containerId: varchar("container_id", { length: 100 }),
  // idle | provisioning | running | stopped | restoring | error
  status: varchar("status", { length: 20 }).default("idle").notNull(),
  // Why the last provisioning / restore failed, shown next to the status.
  statusMessage: text("status_message"),
  backupEnabled: boolean("backup_enabled").default(false).notNull(),
  backupCron: varchar("backup_cron", { length: 100 }),
  // A number of archives to keep, not days: worlds are large.
  backupRetention: integer("backup_retention").default(7).notNull(),
  // The modpack the server runs, or null for the plain game.
  modpack: jsonb("modpack").$type<GameModpackI>(),
  // Mod env rendered at the last provisioning, without API keys. A mismatch
  // with what the current list renders is "changes pending".
  appliedModEnv: jsonb("applied_mod_env").$type<Record<string, string>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Host ports allocated to game servers. The unique index on
 * (server_key, host_port, protocol) is what keeps two servers off one port.
 */
const gameServerPorts = pgTable("game_server_ports", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameServerId: uuid("game_server_id")
    .references(() => gameServers.id, { onDelete: "cascade" })
    .notNull(),
  // 'local', or the uuid of a remote server.
  serverKey: varchar("server_key", { length: 64 }).default("local").notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  protocol: varchar("protocol", { length: 3 }).$type<"tcp" | "udp">().notNull(),
  containerPort: integer("container_port").notNull(),
  hostPort: integer("host_port").notNull(),
});

const gameServerBackups = pgTable("game_server_backups", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameServerId: uuid("game_server_id")
    .references(() => gameServers.id, { onDelete: "cascade" })
    .notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  // running | success | failed
  status: varchar("status", { length: 20 }).default("running").notNull(),
  // manual | schedule | pre-restore
  trigger: varchar("trigger", { length: 20 }).notNull(),
  triggeredBy: uuid("triggered_by").references(() => users.id, {
    onDelete: "set null",
  }),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

/**
 * Mods a server wants, pinned to a version. The image installs them. A
 * unique index on (game_server_id, source, project_id) lives in 0027.
 */
const gameServerMods = pgTable("game_server_mods", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameServerId: uuid("game_server_id")
    .references(() => gameServers.id, { onDelete: "cascade" })
    .notNull(),
  source: varchar("source", { length: 20 }).$type<ModSourceIdT>().notNull(),
  projectId: varchar("project_id", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 200 }),
  name: varchar("name", { length: 200 }).notNull(),
  iconUrl: varchar("icon_url", { length: 1000 }),
  kind: varchar("kind", { length: 10 }).$type<"mod" | "plugin">().default("mod").notNull(),
  // Null for Workshop items, which cannot be pinned.
  versionId: varchar("version_id", { length: 100 }),
  versionLabel: varchar("version_label", { length: 200 }),
  enabled: boolean("enabled").default(true).notNull(),
  addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const gameServerRelations = relations(gameServers, ({ one, many }) => ({
  project: one(projects, {
    fields: [gameServers.projectId],
    references: [projects.id],
  }),
  server: one(servers, {
    fields: [gameServers.serverId],
    references: [servers.id],
  }),
  ports: many(gameServerPorts),
  backups: many(gameServerBackups),
  mods: many(gameServerMods),
}));

const gameServerModRelations = relations(gameServerMods, ({ one }) => ({
  gameServer: one(gameServers, {
    fields: [gameServerMods.gameServerId],
    references: [gameServers.id],
  }),
}));

const gameServerPortRelations = relations(gameServerPorts, ({ one }) => ({
  gameServer: one(gameServers, {
    fields: [gameServerPorts.gameServerId],
    references: [gameServers.id],
  }),
}));

const gameServerBackupRelations = relations(gameServerBackups, ({ one }) => ({
  gameServer: one(gameServers, {
    fields: [gameServerBackups.gameServerId],
    references: [gameServers.id],
  }),
}));

type GameServerT = typeof gameServers.$inferSelect;
type NewGameServerT = typeof gameServers.$inferInsert;
type GameServerPortT = typeof gameServerPorts.$inferSelect;
type GameServerBackupT = typeof gameServerBackups.$inferSelect;
type GameServerModT = typeof gameServerMods.$inferSelect;
type NewGameServerModT = typeof gameServerMods.$inferInsert;

export {
  gameServers,
  gameServerPorts,
  gameServerBackups,
  gameServerMods,
  gameServerRelations,
  gameServerModRelations,
  gameServerPortRelations,
  gameServerBackupRelations,
  type GameServerT,
  type NewGameServerT,
  type GameServerPortT,
  type GameServerBackupT,
  type GameServerModT,
  type NewGameServerModT,
  type GameModpackI,
};
