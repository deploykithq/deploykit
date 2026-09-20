import { z } from "zod";

import { FQDN_REGEX } from "../types";

/**
 * Inputs accepted by the `compose.*` and `template.*` procedures.
 *
 * A Compose service is a whole stack (one `docker-compose.yml`) owned by a
 * project, deployed under the Compose project name `dk-<name>`. It comes either
 * from a catalogue blueprint (`source_type = "template"`) or from YAML the user
 * pasted (`source_type = "raw"`).
 */

/**
 * Stack name. It becomes the `docker compose -p` project name, which the daemon
 * uses to prefix container, network and volume names — hence the same
 * lowercase/hyphen shape Docker itself accepts.
 */
const composeNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Use lowercase letters, numbers and hyphens (must start with a letter or number)",
  );

const domainSchema = z
  .string()
  .min(1)
  .max(255)
  .transform((d) => d.toLowerCase().trim())
  .refine((d) => FQDN_REGEX.test(d), {
    message: "Invalid domain name. Use a valid FQDN like 'app.example.com'",
  });

const composeSourceType = z.enum(["template", "raw"]);

/** Deploy a catalogue blueprint into a project. */
const deployTemplateSchema = z.object({
  templateId: z.string().min(1).max(64),
  projectId: z.string().uuid(),
  name: composeNameSchema,
  serverId: z.string().uuid().nullable().optional(),
  /**
   * Base domain for the stack's `${domain}` variables. Omitted means "generate
   * one", which yields an sslip.io host pointing at the target server's IP so a
   * template is reachable without the user owning a domain.
   */
  domain: domainSchema.optional(),
});

/** Create a stack from pasted Compose YAML. */
const createComposeSchema = z.object({
  projectId: z.string().uuid(),
  name: composeNameSchema,
  composeFile: z.string().min(1).max(500_000),
  serverId: z.string().uuid().nullable().optional(),
});

const updateComposeFileSchema = z.object({
  id: z.string().uuid(),
  composeFile: z.string().min(1).max(500_000),
});

const updateComposeEnvVarsSchema = z.object({
  id: z.string().uuid(),
  envVars: z.record(
    z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid env var name"),
    z.string().max(10_000),
  ),
});

/**
 * Point a domain at one service of the stack. `serviceName` must exist under
 * `services:` in the Compose file — the router validates that, because a typo
 * would otherwise produce Traefik labels attached to nothing and a stack that
 * silently isn't reachable.
 */
const addComposeDomainSchema = z.object({
  id: z.string().uuid(),
  serviceName: z.string().min(1).max(100),
  domain: domainSchema,
  port: z.number().int().min(1).max(65535),
  path: z.string().max(255).optional(),
  https: z.boolean().default(true),
});

type ComposeSourceTypeT = z.infer<typeof composeSourceType>;
type DeployTemplateInputT = z.infer<typeof deployTemplateSchema>;
type CreateComposeInputT = z.infer<typeof createComposeSchema>;
type AddComposeDomainInputT = z.infer<typeof addComposeDomainSchema>;

export {
  composeNameSchema,
  composeSourceType,
  deployTemplateSchema,
  createComposeSchema,
  updateComposeFileSchema,
  updateComposeEnvVarsSchema,
  addComposeDomainSchema,
  type ComposeSourceTypeT,
  type DeployTemplateInputT,
  type CreateComposeInputT,
  type AddComposeDomainInputT,
};
