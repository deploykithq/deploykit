-- Mods & modpacks for game servers, and instance-wide settings (API keys).

CREATE TABLE IF NOT EXISTS "instance_settings" (
  "key"        varchar(100) PRIMARY KEY,
  "value"      text NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "instance_settings"
    ADD CONSTRAINT "instance_settings_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "game_server_mods" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_server_id" uuid NOT NULL,
  "source"         varchar(20) NOT NULL,
  "project_id"     varchar(100) NOT NULL,
  "slug"           varchar(200),
  "name"           varchar(200) NOT NULL,
  "icon_url"       varchar(1000),
  "kind"           varchar(10) DEFAULT 'mod' NOT NULL,
  "version_id"     varchar(100),
  "version_label"  varchar(200),
  "enabled"        boolean DEFAULT true NOT NULL,
  "added_by"       uuid,
  "created_at"     timestamp DEFAULT now() NOT NULL,
  "updated_at"     timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "game_server_mods"
    ADD CONSTRAINT "game_server_mods_game_server_id_fk"
    FOREIGN KEY ("game_server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "game_server_mods"
    ADD CONSTRAINT "game_server_mods_added_by_users_id_fk"
    FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "game_server_mods"
    ADD CONSTRAINT "game_server_mods_source_check"
    CHECK ("source" IN ('modrinth', 'curseforge', 'steam-workshop'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "game_server_mods_project_unique"
  ON "game_server_mods" ("game_server_id", "source", "project_id");

ALTER TABLE "game_servers" ADD COLUMN IF NOT EXISTS "modpack" jsonb;
ALTER TABLE "game_servers" ADD COLUMN IF NOT EXISTS "applied_mod_env" jsonb;
