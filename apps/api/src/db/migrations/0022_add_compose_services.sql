-- Compose stacks: a whole docker-compose.yml deployed as one unit, alongside
-- the existing single-container `applications`.
--
-- `compose_file` is the YAML as authored. The Traefik labels, the shared
-- network and the deploykit.* labels are injected at deploy time rather than
-- stored, so editing routing never means rewriting the user's file.
--
-- `env_vars` is the AES-256-GCM blob (lib/encryption.ts). It is written out as
-- a .env next to the compose file at deploy time, which is what lets Compose
-- interpolate ${VAR} in the YAML.
CREATE TABLE IF NOT EXISTS "compose_services" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id"          uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name"                varchar(255) NOT NULL,
  "source_type"         varchar(20) DEFAULT 'template' NOT NULL,
  "template_id"         varchar(100),
  "template_version"    varchar(50),
  "compose_file"        text NOT NULL,
  "env_vars"            text,
  "mounts"              jsonb,
  "server_id"           uuid REFERENCES "servers"("id") ON DELETE SET NULL,
  "status"              varchar(20) DEFAULT 'idle' NOT NULL,
  "status_page_visible" boolean DEFAULT false NOT NULL,
  "created_at"          timestamp DEFAULT now() NOT NULL,
  "updated_at"          timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "compose_services_project_idx"
  ON "compose_services" ("project_id");

-- A stack has many services, so routing needs to name the one to route to —
-- which is why this can't reuse the `domains` table.
CREATE TABLE IF NOT EXISTS "compose_domains" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "compose_service_id"   uuid NOT NULL REFERENCES "compose_services"("id") ON DELETE CASCADE,
  "service_name"         varchar(100) NOT NULL,
  "domain"               varchar(255) NOT NULL,
  "port"                 integer NOT NULL,
  "path"                 varchar(255),
  "https"                boolean DEFAULT true NOT NULL,
  "certificate_resolver" varchar(50) DEFAULT 'letsencrypt',
  "created_at"           timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "compose_domains_service_idx"
  ON "compose_domains" ("compose_service_id");

-- Deployments become polymorphic: exactly one of application_id /
-- compose_service_id is set. Dropping NOT NULL is safe for existing rows (they
-- all have an application_id); the CHECK enforces the invariant from here on.
ALTER TABLE "deployments"
  ALTER COLUMN "application_id" DROP NOT NULL;

ALTER TABLE "deployments"
  ADD COLUMN IF NOT EXISTS "compose_service_id" uuid
    REFERENCES "compose_services"("id") ON DELETE CASCADE;

ALTER TABLE "deployments"
  DROP CONSTRAINT IF EXISTS "deployments_owner_check";

ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_owner_check"
  CHECK (num_nonnulls("application_id", "compose_service_id") = 1);

CREATE INDEX IF NOT EXISTS "deployments_compose_idx"
  ON "deployments" ("compose_service_id");
