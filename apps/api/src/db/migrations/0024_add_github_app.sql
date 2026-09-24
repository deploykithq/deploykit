-- GitHub App integration.
--
-- One row per registered App (normally one; the table allows more so a future
-- GitHub Enterprise Server install can coexist with github.com). private_key,
-- webhook_secret and client_secret hold AES-256-GCM blobs (lib/encryption.ts).
--
-- applications.github_installation_id is ON DELETE SET NULL on purpose: losing
-- the App must never delete an application. Its deploys fall back to
-- source_token (the PAT) or fail with a readable message.
CREATE TABLE IF NOT EXISTS "github_apps" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id"         integer NOT NULL,
  "slug"           varchar(255) NOT NULL,
  "name"           varchar(255) NOT NULL,
  "owner_login"    varchar(255),
  "html_url"       varchar(500),
  "client_id"      varchar(100),
  "client_secret"  text,
  "private_key"    text NOT NULL,
  "webhook_secret" text NOT NULL,
  "api_base_url"   varchar(255) DEFAULT 'https://api.github.com' NOT NULL,
  "web_base_url"   varchar(255) DEFAULT 'https://github.com' NOT NULL,
  "created_by"     uuid,
  "created_at"     timestamp DEFAULT now() NOT NULL,
  "updated_at"     timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "github_apps"
    ADD CONSTRAINT "github_apps_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "github_apps_app_id_idx"
  ON "github_apps" ("app_id");

CREATE TABLE IF NOT EXISTS "github_installations" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "github_app_id"        uuid NOT NULL,
  "installation_id"      bigint NOT NULL,
  "account_login"        varchar(255) NOT NULL,
  "account_type"         varchar(20),
  "account_id"           bigint,
  "repository_selection" varchar(10),
  "suspended_at"         timestamp,
  "created_at"           timestamp DEFAULT now() NOT NULL,
  "updated_at"           timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "github_installations"
    ADD CONSTRAINT "github_installations_github_app_id_fk"
    FOREIGN KEY ("github_app_id") REFERENCES "github_apps"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "github_installations_app_install_idx"
  ON "github_installations" ("github_app_id", "installation_id");

-- Numeric repo id, not the URL: it survives renames and transfers, which is the
-- whole reason the App path stops matching payloads by normalized URL.
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "github_installation_id" uuid;
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "github_repo_id" bigint;
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "github_repo_full_name" varchar(255);
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "commit_status_enabled" boolean DEFAULT true NOT NULL;
-- Preview rows only: the PR comment this preview owns, so a redeploy edits it
-- instead of posting a second one.
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "preview_pr_comment_id" bigint;

DO $$ BEGIN
  ALTER TABLE "applications"
    ADD CONSTRAINT "applications_github_installation_id_fk"
    FOREIGN KEY ("github_installation_id")
    REFERENCES "github_installations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The webhook's hot path: installation + repo id -> candidate applications.
CREATE INDEX IF NOT EXISTS "applications_github_repo_idx"
  ON "applications" ("github_installation_id", "github_repo_id");
