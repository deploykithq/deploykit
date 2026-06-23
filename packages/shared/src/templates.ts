import { z } from "zod";
import type { DatabaseType, SourceType, BuildType } from "./types";

/**
 * One-click templates.
 *
 * A template is a declarative blueprint of one or more resources (databases and/or
 * applications) that the API's `template.deploy` procedure provisions by calling the
 * existing `database.create` / `application.create` / `application.deploy` procedures.
 *
 * Resources are processed in array order. An application resource can pull the
 * connection string of an earlier database resource (via `envFromDatabase`) so that
 * stack templates (e.g. app + database) are wired together automatically.
 */

export type TemplateCategory = "database" | "selfhosted" | "stack" | "app";

export interface TemplateDatabaseResource {
  kind: "database";
  /** Stable id used to reference this resource from later resources. */
  ref: string;
  /** Appended to the user-provided base name to form the resource name. */
  nameSuffix: string;
  type: DatabaseType;
  version?: string;
}

export interface TemplateApplicationResource {
  kind: "application";
  ref: string;
  nameSuffix: string;
  sourceType: SourceType;
  /** Git URL for git sources, or an image reference for `docker_image`. */
  repositoryUrl?: string;
  branch?: string;
  buildType?: BuildType;
  port?: number;
  startCommand?: string;
  /**
   * Container paths to persist (e.g. ["/data"]). Each becomes a deterministic
   * Docker named volume (dk-<name>-<path>) that survives redeploys.
   */
  volumes?: string[];
  /** Static environment variables injected after creation. */
  env?: Record<string, string>;
  /**
   * Inject an earlier database's connection string under `envKey`.
   * `append` is concatenated to the string (e.g. "?sslmode=disable").
   */
  envFromDatabase?: { ref: string; envKey: string; append?: string };
  /** Queue a deployment immediately after creation. */
  autoDeploy?: boolean;
}

export type TemplateResource =
  | TemplateDatabaseResource
  | TemplateApplicationResource;

export interface Template {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Lucide icon name (resolved on the web side) or an emoji. */
  icon: string;
  tags?: string[];
  resources: TemplateResource[];
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const TEMPLATES: Template[] = [
  // --- Databases ---------------------------------------------------------
  {
    id: "postgres-16",
    name: "PostgreSQL 16",
    description: "Production-ready PostgreSQL 16 database with a generated password.",
    category: "database",
    icon: "Database",
    tags: ["sql", "relational"],
    resources: [
      { kind: "database", ref: "db", nameSuffix: "", type: "postgresql", version: "16-alpine" },
    ],
  },
  {
    id: "mysql-8",
    name: "MySQL 8",
    description: "MySQL 8 relational database, ready to connect.",
    category: "database",
    icon: "Database",
    tags: ["sql", "relational"],
    resources: [
      { kind: "database", ref: "db", nameSuffix: "", type: "mysql", version: "8" },
    ],
  },
  {
    id: "mongodb-7",
    name: "MongoDB 7",
    description: "MongoDB 7 document database.",
    category: "database",
    icon: "Database",
    tags: ["nosql", "document"],
    resources: [
      { kind: "database", ref: "db", nameSuffix: "", type: "mongodb", version: "7" },
    ],
  },
  {
    id: "redis-7",
    name: "Redis 7",
    description: "Redis 7 in-memory data store for caching and queues.",
    category: "database",
    icon: "Database",
    tags: ["cache", "kv"],
    resources: [
      { kind: "database", ref: "db", nameSuffix: "", type: "redis", version: "7-alpine" },
    ],
  },
  {
    id: "mariadb-11",
    name: "MariaDB 11",
    description: "MariaDB 11 relational database (MySQL-compatible).",
    category: "database",
    icon: "Database",
    tags: ["sql", "relational"],
    resources: [
      { kind: "database", ref: "db", nameSuffix: "", type: "mariadb", version: "11" },
    ],
  },

  // --- Self-hosted apps (Docker image) -----------------------------------
  {
    id: "n8n",
    name: "n8n",
    description: "Workflow automation tool. Deploys the official n8n image.",
    category: "selfhosted",
    icon: "Workflow",
    tags: ["automation", "no-code"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "n8nio/n8n:latest",
        port: 5678,
        env: { N8N_PORT: "5678", N8N_SECURE_COOKIE: "false" },
        volumes: ["/home/node/.n8n"],
        autoDeploy: true,
      },
    ],
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description: "Self-hosted uptime monitoring with status pages and alerts.",
    category: "selfhosted",
    icon: "Activity",
    tags: ["monitoring", "status"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "louislam/uptime-kuma:1",
        // 3001 collides with the DeployKit dev API; use 3011 and tell Kuma to
        // listen there (no-domain deploys publish host port == container port).
        port: 3011,
        env: { UPTIME_KUMA_PORT: "3011" },
        volumes: ["/app/data"],
        autoDeploy: true,
      },
    ],
  },
  {
    id: "metabase",
    name: "Metabase",
    description: "Open-source business intelligence and dashboards.",
    category: "selfhosted",
    icon: "BarChart3",
    tags: ["analytics", "bi"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "metabase/metabase:latest",
        port: 3000,
        autoDeploy: true,
      },
    ],
  },
  {
    id: "mailpit",
    name: "Mailpit",
    description:
      "Email & SMTP testing tool with a web UI on the published port. Other services can send mail to it at dk-<name>:1025 over the internal network.",
    category: "selfhosted",
    icon: "Mail",
    tags: ["email", "smtp", "dev"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "axllent/mailpit:latest",
        port: 8025,
        autoDeploy: true,
      },
    ],
  },
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    description:
      "Lightweight, self-hosted Bitwarden-compatible password manager. Data persists in a managed volume at /data.",
    category: "selfhosted",
    icon: "KeyRound",
    tags: ["passwords", "security"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "vaultwarden/server:latest",
        port: 8086,
        env: { ROCKET_PORT: "8086" },
        volumes: ["/data"],
        autoDeploy: true,
      },
    ],
  },
  {
    id: "gitea",
    name: "Gitea",
    description:
      "Self-hosted Git service with web UI, issues and pull requests. Complete the setup wizard on first visit.",
    category: "selfhosted",
    icon: "GitBranch",
    tags: ["git", "vcs"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "gitea/gitea:1",
        port: 3030,
        env: {
          GITEA__server__HTTP_PORT: "3030",
          USER_UID: "1000",
          USER_GID: "1000",
        },
        volumes: ["/data"],
        autoDeploy: true,
      },
    ],
  },
  {
    id: "grafana",
    name: "Grafana",
    description:
      "Observability dashboards and data visualization. Default login: admin / admin.",
    category: "selfhosted",
    icon: "Gauge",
    tags: ["monitoring", "dashboards"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "grafana/grafana:latest",
        port: 3033,
        env: { GF_SERVER_HTTP_PORT: "3033" },
        volumes: ["/var/lib/grafana"],
        autoDeploy: true,
      },
    ],
  },
  {
    id: "memos",
    name: "Memos",
    description:
      "Lightweight, privacy-first note-taking and memo hub (SQLite, no setup).",
    category: "selfhosted",
    icon: "StickyNote",
    tags: ["notes", "markdown"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "neosmemo/memos:stable",
        port: 5230,
        volumes: ["/var/opt/memos"],
        autoDeploy: true,
      },
    ],
  },
  {
    id: "gotify",
    name: "Gotify",
    description:
      "Simple server for sending and receiving push notifications. Default login: admin / admin.",
    category: "selfhosted",
    icon: "BellRing",
    tags: ["notifications"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "gotify/server:latest",
        port: 8088,
        env: { GOTIFY_SERVER_PORT: "8088" },
        volumes: ["/app/data"],
        autoDeploy: true,
      },
    ],
  },
  {
    id: "code-server",
    name: "code-server",
    description:
      "VS Code running in the browser. Default access password: change-me-now (change it in Environment).",
    category: "selfhosted",
    icon: "Code",
    tags: ["ide", "dev"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "linuxserver/code-server:latest",
        port: 8443,
        env: { PASSWORD: "change-me-now" },
        volumes: ["/config"],
        autoDeploy: true,
      },
    ],
  },
  {
    id: "pgadmin",
    name: "pgAdmin 4",
    description:
      "Web UI to manage PostgreSQL databases. Login: admin@example.com / change-me-now.",
    category: "selfhosted",
    icon: "Database",
    tags: ["postgres", "admin"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "dpage/pgadmin4:latest",
        port: 8089,
        env: {
          PGADMIN_LISTEN_PORT: "8089",
          PGADMIN_DEFAULT_EMAIL: "admin@example.com",
          PGADMIN_DEFAULT_PASSWORD: "change-me-now",
        },
        volumes: ["/var/lib/pgadmin"],
        autoDeploy: true,
      },
    ],
  },

  // --- Git starter app ---------------------------------------------------
  {
    id: "node-starter",
    name: "Node.js Starter",
    description:
      "A minimal Node.js (Express) app built with Nixpacks. Review and deploy from the app page.",
    category: "app",
    icon: "Boxes",
    tags: ["node", "express"],
    resources: [
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "github",
        repositoryUrl: "https://github.com/heroku/node-js-getting-started",
        branch: "main",
        buildType: "nixpacks",
        port: 3000,
        env: { PORT: "3000" },
        autoDeploy: false,
      },
    ],
  },

  // --- Stack (app + database) -------------------------------------------
  {
    id: "node-postgres",
    name: "Node.js + PostgreSQL",
    description:
      "A Node.js app wired to a fresh PostgreSQL 16 database via DATABASE_URL. Deploys automatically.",
    category: "stack",
    icon: "Layers",
    tags: ["node", "postgres", "fullstack"],
    resources: [
      { kind: "database", ref: "db", nameSuffix: "-db", type: "postgresql", version: "16-alpine" },
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "github",
        repositoryUrl: "https://github.com/heroku/node-js-getting-started",
        branch: "main",
        buildType: "nixpacks",
        port: 3000,
        env: { PORT: "3000" },
        envFromDatabase: { ref: "db", envKey: "DATABASE_URL" },
        autoDeploy: true,
      },
    ],
  },
  {
    id: "umami-postgres",
    name: "Umami + PostgreSQL",
    description:
      "Privacy-friendly web analytics wired to a fresh PostgreSQL 16 database. Default login: admin / umami.",
    category: "stack",
    icon: "BarChart3",
    tags: ["analytics", "postgres"],
    resources: [
      { kind: "database", ref: "db", nameSuffix: "-db", type: "postgresql", version: "16-alpine" },
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "ghcr.io/umami-software/umami:postgresql-latest",
        port: 8087,
        env: { DATABASE_TYPE: "postgresql", PORT: "8087" },
        envFromDatabase: { ref: "db", envKey: "DATABASE_URL" },
        autoDeploy: true,
      },
    ],
  },
  {
    id: "miniflux-postgres",
    name: "Miniflux + PostgreSQL",
    description:
      "Minimalist, fast RSS reader wired to PostgreSQL. Default login: admin / change-me-now (change it after first login).",
    category: "stack",
    icon: "Rss",
    tags: ["rss", "postgres"],
    resources: [
      { kind: "database", ref: "db", nameSuffix: "-db", type: "postgresql", version: "16-alpine" },
      {
        kind: "application",
        ref: "app",
        nameSuffix: "",
        sourceType: "docker_image",
        repositoryUrl: "miniflux/miniflux:latest",
        port: 8085,
        env: {
          PORT: "8085",
          RUN_MIGRATIONS: "1",
          CREATE_ADMIN: "1",
          ADMIN_USERNAME: "admin",
          ADMIN_PASSWORD: "change-me-now",
        },
        envFromDatabase: {
          ref: "db",
          envKey: "DATABASE_URL",
          append: "?sslmode=disable",
        },
        autoDeploy: true,
      },
    ],
  },
];

export const getTemplateById = (id: string): Template | undefined =>
  TEMPLATES.find((t) => t.id === id);

/**
 * Input accepted by the `template.deploy` procedure.
 */
export const deployTemplateSchema = z.object({
  templateId: z.string().min(1),
  projectId: z.string().uuid(),
  /** Base name; resource-specific suffixes are appended. */
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Use lowercase letters, numbers and hyphens (must start with a letter or number)",
    ),
  serverId: z.string().uuid().nullable().optional(),
});

export type DeployTemplateInput = z.infer<typeof deployTemplateSchema>;
