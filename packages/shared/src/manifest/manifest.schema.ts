import { z } from "zod";

import {
  BuildType,
  DatabaseType,
  DOCKERFILE_PATH_REGEX,
  FQDN_REGEX,
  HTTP_PATH_REGEX,
  RELATIVE_PATH_REGEX,
  repositoryUrlSchema,
  SourceType,
  UserRole,
} from "../types";
import { createTaskSchema } from "../tasks";
import {
  composeNameSchema,
  composeSourceType,
} from "../templates/compose.schema";

/**
 * The instance configuration manifest: a YAML document describing projects,
 * applications, databases, Compose stacks, domains, env vars and scheduled
 * tasks, so an instance can be rebuilt on another host or reviewed in git.
 *
 * Two documents, the same tree, paired **by name**:
 *
 * - `deploykit/instance-config` carries everything that is safe to commit.
 * - `deploykit/instance-secrets` carries the values withheld from it.
 *
 * Every field reuses the validator the matching `*.create` / `*.update`
 * procedure already uses, so a manifest can never describe something the API
 * itself would reject.
 */

/** Bumped only on a breaking change to the document shape. */
const MANIFEST_VERSION = 1;
const CONFIG_MANIFEST_KIND = "deploykit/instance-config";
const SECRETS_MANIFEST_KIND = "deploykit/instance-secrets";

/**
 * Longest document we accept over the wire. The Compose files dominate the
 * size (500 000 chars each), which is also why the API raises Fastify's body
 * limit above its 1 MiB default.
 */
const MANIFEST_MAX_LENGTH = 2_000_000;
const SECRETS_MAX_LENGTH = 500_000;

/** Names used in `withheldSecrets` for the fields that are not env vars. */
const WITHHELD_SOURCE_TOKEN = "sourceToken";
const WITHHELD_WEBHOOK_SECRET = "webhookSecret";
const WITHHELD_DB_PASSWORD = "password";
/** A stack mount's contents live in the secrets document under this name. */
const mountWithheldName = (filePath: string): string => `mount:${filePath}`;
/** A withheld build arg, namespaced so it cannot collide with an env var. */
const buildArgWithheldName = (key: string): string => `buildArg:${key}`;

const envKeySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid env var name");

const envMapSchema = z.record(envKeySchema, z.string().max(10_000));

const hostnameSchema = z
  .string()
  .min(1)
  .max(255)
  .transform((d) => d.toLowerCase().trim())
  .refine((d) => FQDN_REGEX.test(d), {
    message: "Invalid domain name. Use a valid FQDN like 'app.example.com'",
  });

/**
 * A server is referenced by name, not id: the point of the manifest is to be
 * applied to an instance that does not share this one's rows. A name that does
 * not resolve on the target lands the resource on the local daemon, with a
 * warning in the import plan.
 */
const serverRefSchema = z.string().min(1).max(100).nullable().optional();

const withheldSecretsSchema = z
  .array(z.string().min(1).max(300))
  .max(500)
  .optional();

const resourceNameSchema = z.string().min(1).max(100);

/** The task fields, minus the target — the owner is the enclosing resource. */
const manifestTaskSchema = createTaskSchema.omit({ target: true });

/** A stack task must name the service to run in, exactly as `task.create` requires. */
const manifestStackTaskSchema = manifestTaskSchema.extend({
  serviceName: z.string().min(1).max(100),
});

const manifestDomainSchema = z.object({
  domain: hostnameSchema,
  port: z.number().int().min(1).max(65535),
  https: z.boolean().default(true),
  certificateResolver: z.string().max(50).nullable().optional(),
});

const manifestStackDomainSchema = manifestDomainSchema.extend({
  serviceName: z.string().min(1).max(100),
  path: z.string().max(255).nullable().optional(),
});

const manifestApplicationSchema = z.object({
  name: resourceNameSchema,
  // Source
  sourceType: SourceType,
  repositoryUrl: repositoryUrlSchema.nullable().optional(),
  branch: z.string().max(100).default("main"),
  rootDirectory: z
    .string()
    .max(255)
    .regex(RELATIVE_PATH_REGEX, "Invalid root directory")
    .nullable()
    .optional(),
  // Build
  buildType: BuildType.default("nixpacks"),
  dockerfilePath: z
    .string()
    .max(255)
    .regex(DOCKERFILE_PATH_REGEX, "Invalid Dockerfile path")
    .nullable()
    .optional(),
  buildArgs: envMapSchema.nullable().optional(),
  startCommand: z.string().max(500).nullable().optional(),
  // Runtime
  port: z.number().int().min(1).max(65535).nullable().optional(),
  volumes: z.array(z.string().max(500)).max(20).optional(),
  cpuLimit: z.number().int().min(100).max(8000).nullable().optional(),
  memoryLimit: z.number().int().min(64).max(32768).nullable().optional(),
  replicas: z.number().int().min(1).max(10).default(1),
  autoscale: z
    .object({
      enabled: z.boolean().default(false),
      min: z.number().int().min(1).max(10).default(1),
      max: z.number().int().min(1).max(10).default(3),
      cpuTarget: z.number().int().min(10).max(100).nullable().optional(),
      memTarget: z.number().int().min(10).max(100).nullable().optional(),
      cooldown: z.number().int().min(30).max(3600).default(180),
    })
    .optional(),
  healthCheck: z
    .object({
      type: z.enum(["http", "tcp", "none"]).default("http"),
      path: z
        .string()
        .max(255)
        .regex(HTTP_PATH_REGEX, "Invalid health check path")
        .nullable()
        .optional(),
      timeout: z.number().int().min(1).max(60).default(5),
      interval: z.number().int().min(1).max(60).default(10),
      retries: z.number().int().min(1).max(20).default(6),
      required: z.boolean().default(false),
    })
    .optional(),
  preview: z
    .object({
      enabled: z.boolean().default(false),
      domain: z.string().max(255).nullable().optional(),
    })
    .optional(),
  statusPageVisible: z.boolean().default(false),
  scanEnabled: z.boolean().nullable().optional(),
  server: serverRefSchema,
  env: envMapSchema.optional(),
  withheldSecrets: withheldSecretsSchema,
  domains: z.array(manifestDomainSchema).max(50).optional(),
  tasks: z.array(manifestTaskSchema).max(100).optional(),
});

const manifestDatabaseSchema = z.object({
  name: resourceNameSchema,
  type: DatabaseType,
  version: z.string().max(50).nullable().optional(),
  internalPort: z.number().int().min(1).max(65535),
  dbUser: z.string().max(100).nullable().optional(),
  databaseName: z.string().max(255).nullable().optional(),
  replicaSet: z.boolean().default(false),
  server: serverRefSchema,
  backup: z
    .object({
      enabled: z.boolean().default(false),
      cron: z.string().max(100).nullable().optional(),
      retention: z.number().int().min(1).max(365).default(7),
    })
    .optional(),
  withheldSecrets: withheldSecretsSchema,
  tasks: z.array(manifestTaskSchema).max(100).optional(),
});

const manifestMountSchema = z.object({
  filePath: z.string().max(255).regex(RELATIVE_PATH_REGEX, "Invalid mount path"),
  /**
   * Withheld from the config document — a template resolves its mounts, so the
   * contents routinely carry a generated credential. A hand-written manifest
   * may still inline it.
   */
  content: z.string().max(100_000).optional(),
});

const manifestStackSchema = z.object({
  name: composeNameSchema,
  sourceType: composeSourceType.default("raw"),
  /** Provenance only: a stack is rebuilt from `composeFile`, not re-resolved. */
  template: z
    .object({
      id: z.string().max(100),
      version: z.string().max(50).nullable().optional(),
    })
    .nullable()
    .optional(),
  composeFile: z.string().min(1).max(500_000),
  mounts: z.array(manifestMountSchema).max(20).optional(),
  statusPageVisible: z.boolean().default(false),
  server: serverRefSchema,
  env: envMapSchema.optional(),
  withheldSecrets: withheldSecretsSchema,
  domains: z.array(manifestStackDomainSchema).max(50).optional(),
  tasks: z.array(manifestStackTaskSchema).max(100).optional(),
});

const manifestProjectSchema = z.object({
  name: resourceNameSchema,
  description: z.string().max(500).nullable().optional(),
  statusPage: z
    .object({
      enabled: z.boolean().default(false),
      slug: z.string().max(80).nullable().optional(),
      title: z.string().max(255).nullable().optional(),
    })
    .optional(),
  /** Matched by email: the import never creates users. */
  members: z
    .array(z.object({ email: z.string().email(), role: UserRole }))
    .max(200)
    .optional(),
  applications: z.array(manifestApplicationSchema).max(200).optional(),
  databases: z.array(manifestDatabaseSchema).max(200).optional(),
  stacks: z.array(manifestStackSchema).max(200).optional(),
});

const configManifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  kind: z.literal(CONFIG_MANIFEST_KIND),
  exportedAt: z.string().max(40).optional(),
  projects: z.array(manifestProjectSchema).max(500),
});

const secretsManifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  kind: z.literal(SECRETS_MANIFEST_KIND),
  exportedAt: z.string().max(40).optional(),
  projects: z
    .array(
      z.object({
        name: resourceNameSchema,
        applications: z
          .array(
            z.object({
              name: resourceNameSchema,
              env: envMapSchema.optional(),
              buildArgs: envMapSchema.optional(),
              sourceToken: z.string().max(500).nullable().optional(),
              webhookSecret: z.string().max(200).nullable().optional(),
            }),
          )
          .max(200)
          .optional(),
        databases: z
          .array(
            z.object({
              name: resourceNameSchema,
              password: z.string().max(500).nullable().optional(),
            }),
          )
          .max(200)
          .optional(),
        stacks: z
          .array(
            z.object({
              name: composeNameSchema,
              env: envMapSchema.optional(),
              mounts: z
                .array(
                  z.object({
                    filePath: z.string().max(255),
                    content: z.string().max(100_000),
                  }),
                )
                .max(20)
                .optional(),
            }),
          )
          .max(200)
          .optional(),
      }),
    )
    .max(500),
});

type ConfigManifestI = z.infer<typeof configManifestSchema>;
type SecretsManifestI = z.infer<typeof secretsManifestSchema>;
type ManifestProjectI = z.infer<typeof manifestProjectSchema>;
type ManifestApplicationI = z.infer<typeof manifestApplicationSchema>;
type ManifestDatabaseI = z.infer<typeof manifestDatabaseSchema>;
type ManifestStackI = z.infer<typeof manifestStackSchema>;
type ManifestDomainI = z.infer<typeof manifestDomainSchema>;
type ManifestStackDomainI = z.infer<typeof manifestStackDomainSchema>;
type ManifestTaskI = z.infer<typeof manifestTaskSchema>;
type ManifestStackTaskI = z.infer<typeof manifestStackTaskSchema>;
type ManifestMountI = z.infer<typeof manifestMountSchema>;

export {
  MANIFEST_VERSION,
  CONFIG_MANIFEST_KIND,
  SECRETS_MANIFEST_KIND,
  MANIFEST_MAX_LENGTH,
  SECRETS_MAX_LENGTH,
  WITHHELD_SOURCE_TOKEN,
  WITHHELD_WEBHOOK_SECRET,
  WITHHELD_DB_PASSWORD,
  mountWithheldName,
  buildArgWithheldName,
  configManifestSchema,
  secretsManifestSchema,
  manifestProjectSchema,
  manifestApplicationSchema,
  manifestDatabaseSchema,
  manifestStackSchema,
  type ConfigManifestI,
  type SecretsManifestI,
  type ManifestProjectI,
  type ManifestApplicationI,
  type ManifestDatabaseI,
  type ManifestStackI,
  type ManifestDomainI,
  type ManifestStackDomainI,
  type ManifestTaskI,
  type ManifestStackTaskI,
  type ManifestMountI,
};
