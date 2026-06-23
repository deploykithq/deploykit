import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { projects } from "./projects";
import { servers } from "./servers";
import { deployments } from "./deployments";
import { domains } from "./domains";

export const applications = pgTable("applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  // Source
  sourceType: varchar("source_type", { length: 20 })
    .default("github")
    .notNull(),
  repositoryUrl: varchar("repository_url", { length: 500 }),
  branch: varchar("branch", { length: 100 }).default("main").notNull(),
  sourceToken: text("source_token"),
  rootDirectory: varchar("root_directory", { length: 255 }),
  // Build
  buildType: varchar("build_type", { length: 20 })
    .default("nixpacks")
    .notNull(),
  dockerfilePath: varchar("dockerfile_path", { length: 255 }).default(
    "./Dockerfile",
  ),
  buildArgs: jsonb("build_args").$type<Record<string, string>>(),
  startCommand: text("start_command"),
  // Runtime
  envVars: text("env_vars"),
  volumes: jsonb("volumes").$type<string[]>(),
  port: integer("port"),
  // Resources
  cpuLimit: integer("cpu_limit"), // millicores (null = unlimited); 1000 = 1 core
  memoryLimit: integer("memory_limit"), // MB (null = unlimited)
  replicas: integer("replicas").default(1).notNull(), // instances behind Traefik LB
  // Autoscaling (requires a domain — replicas ride Traefik LB)
  autoscaleEnabled: boolean("autoscale_enabled").default(false).notNull(),
  autoscaleMin: integer("autoscale_min").default(1).notNull(), // lower replica bound
  autoscaleMax: integer("autoscale_max").default(3).notNull(), // upper replica bound
  autoscaleCpuTarget: integer("autoscale_cpu_target"), // target avg CPU % (null = ignore)
  autoscaleMemTarget: integer("autoscale_mem_target"), // target avg mem % (null = ignore)
  autoscaleCooldown: integer("autoscale_cooldown").default(180).notNull(), // seconds between actions
  // Server
  serverId: uuid("server_id").references(() => servers.id, {
    onDelete: "set null",
  }),
  // Container state
  status: varchar("status", { length: 20 }).default("idle").notNull(),
  containerId: varchar("container_id", { length: 100 }),
  containerImage: varchar("container_image", { length: 500 }),
  // Health check config
  healthCheckType: varchar("health_check_type", { length: 10 })
    .default("http")
    .notNull(),
  healthCheckPath: varchar("health_check_path", { length: 255 }).default("/"),
  healthCheckTimeout: integer("health_check_timeout").default(5).notNull(),
  healthCheckInterval: integer("health_check_interval").default(10).notNull(),
  healthCheckRetries: integer("health_check_retries").default(6).notNull(),
  healthCheckRequired: boolean("health_check_required")
    .default(false)
    .notNull(),
  // Preview deployments
  previewEnabled: boolean("preview_enabled").default(false).notNull(), // parent: enables PR previews
  previewDomain: varchar("preview_domain", { length: 255 }), // base domain, e.g. "example.com"
  isPreview: boolean("is_preview").default(false).notNull(), // true = this IS a preview
  parentApplicationId: uuid("parent_application_id"), // preview → parent link
  previewPrNumber: integer("preview_pr_number"), // PR/MR number
  previewBranch: varchar("preview_branch", { length: 100 }), // head branch of the PR
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const applicationRelations = relations(
  applications,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [applications.projectId],
      references: [projects.id],
    }),
    server: one(servers, {
      fields: [applications.serverId],
      references: [servers.id],
    }),
    deployments: many(deployments),
    domains: many(domains),
    // Self-referencing: preview → parent
    parentApplication: one(applications, {
      fields: [applications.parentApplicationId],
      references: [applications.id],
      relationName: "preview_parent",
    }),
    // Self-referencing: parent → previews
    previews: many(applications, {
      relationName: "preview_parent",
    }),
  }),
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
