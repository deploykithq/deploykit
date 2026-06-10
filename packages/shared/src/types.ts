import { z } from "zod";

// A safe relative path: no leading slash, no "..", only word chars, dots,
// dashes and forward slashes. Used for build context sub-paths to prevent
// path traversal on the build host.
export const RELATIVE_PATH_REGEX = /^(?!.*\.\.)[A-Za-z0-9._][A-Za-z0-9._\-/]*$/;

// Same, but a leading "./" is allowed (Dockerfile locations).
export const DOCKERFILE_PATH_REGEX =
  /^(?:\.\/)?(?!.*\.\.)[A-Za-z0-9._][A-Za-z0-9._\-/]*$/;

// HTTP request path: must start with "/", no "..", no scheme/host injection.
export const HTTP_PATH_REGEX = /^\/(?!.*\.\.)[A-Za-z0-9._\-/~%?&=]*$/;

export const SourceType = z.enum(["github", "gitlab", "git", "docker_image"]);
export const BuildType = z.enum(["dockerfile", "nixpacks", "buildpacks"]);
export const ServiceStatus = z.enum([
  "idle",
  "building",
  "deploying",
  "running",
  "stopped",
  "error",
]);
export const DatabaseType = z.enum([
  "postgresql",
  "mongodb",
  "redis",
  "mysql",
  "mariadb",
]);
export const ServerStatus = z.enum(["connected", "disconnected", "error"]);
export const DeployStatus = z.enum([
  "queued",
  "building",
  "deploying",
  "success",
  "failed",
  "cancelled",
]);
export const BackupStatus = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export const UserRole = z.enum(["admin", "operator", "viewer"]);

export type SourceType = z.infer<typeof SourceType>;
export type BuildType = z.infer<typeof BuildType>;
export type ServiceStatus = z.infer<typeof ServiceStatus>;
export type DatabaseType = z.infer<typeof DatabaseType>;
export type ServerStatus = z.infer<typeof ServerStatus>;
export type DeployStatus = z.infer<typeof DeployStatus>;
export type BackupStatus = z.infer<typeof BackupStatus>;
export type UserRole = z.infer<typeof UserRole>;

// Validators
export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const createApplicationSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  // Source
  sourceType: SourceType,
  repositoryUrl: z.string().url().optional(),
  branch: z.string().max(100).default("main"),
  sourceToken: z.string().max(500).optional(), // PAT for private repos
  rootDirectory: z
    .string()
    .max(255)
    .regex(RELATIVE_PATH_REGEX, "Invalid root directory")
    .optional(), // subdirectory for monorepos
  // Build
  buildType: BuildType.default("nixpacks"),
  dockerfilePath: z
    .string()
    .max(255)
    .regex(DOCKERFILE_PATH_REGEX, "Invalid Dockerfile path")
    .default("./Dockerfile"),
  startCommand: z.string().max(500).optional(), // override Nixpacks start command (e.g. "npm run start:prod")
  // Runtime
  port: z.number().int().min(1).max(65535).optional(),
  volumes: z.array(z.string().max(500)).max(20).optional(), // ["host:container"]
  // Server
  serverId: z.string().uuid().nullable().optional(),
});

export const createDatabaseSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: DatabaseType,
  version: z.string().max(50).optional(),
  serverId: z.string().uuid().nullable().optional(),
  replicaSet: z.boolean().default(false),
});

export const createServerSchema = z.object({
  name: z.string().min(1).max(100),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().max(100).default("root"),
  sshKeyPath: z.string().max(500).optional(),
  sshKeyContent: z.string().optional(), // raw private key — will be encrypted on server
});

export const updateEnvVarsSchema = z.object({
  serviceId: z.string().uuid(),
  envVars: z.record(
    z.string().min(1).max(256).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid env var name"),
    z.string().max(10_000),
  ),
});

/**
 * Valid FQDN: labels separated by dots, each 1-63 chars of [a-z0-9-],
 * no leading/trailing hyphens, TLD at least 2 chars.
 * Wildcards (*.example.com) are allowed for preview domains.
 */
const FQDN_REGEX =
  /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const addDomainSchema = z.object({
  serviceId: z.string().uuid(),
  domain: z
    .string()
    .min(1)
    .max(255)
    .transform((d) => d.toLowerCase().trim())
    .refine((d) => FQDN_REGEX.test(d), {
      message:
        "Invalid domain name. Use a valid FQDN like 'app.example.com'",
    }),
  https: z.boolean().default(true),
  port: z.number().int().min(1).max(65535),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: UserRole.default("viewer"),
});

export const updateUserRoleSchema = z.object({
  id: z.string().uuid(),
  role: UserRole,
});

// Docker image defaults

export const DATABASE_IMAGES: Record<
  DatabaseType,
  { image: string; defaultPort: number }
> = {
  postgresql: { image: "postgres:16-alpine", defaultPort: 5432 },
  mongodb: { image: "mongo:7", defaultPort: 27017 },
  redis: { image: "redis:7-alpine", defaultPort: 6379 },
  mysql: { image: "mysql:8", defaultPort: 3306 },
  mariadb: { image: "mariadb:11", defaultPort: 3306 },
};

// Notifications

export const ChannelType = z.enum([
  "discord",
  "slack",
  "telegram",
  "email",
  "webhook",
]);
export type ChannelType = z.infer<typeof ChannelType>;

export const NotificationEvent = z.enum([
  "deploy.success",
  "deploy.failed",
  "app.stopped",
  "app.error",
  "backup.failed",
  "backup.completed",
  "health_check.failed",
  "alert.fired",
]);
export type NotificationEvent = z.infer<typeof NotificationEvent>;

export const createNotificationChannelSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(100),
  type: ChannelType,
  config: z.record(z.string(), z.string()),
  events: z.array(NotificationEvent).min(1),
  enabled: z.boolean().default(true),
});
