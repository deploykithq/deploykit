-- Game servers: one image-based container per server, configured from a game
-- definition in the template catalogue (`games/<id>/game.json`).
--
-- `spec` is a snapshot of that definition taken at creation, so a later edit
-- in the registry never changes a server that is already running. The values
-- the user entered are split: `config` holds the plain ones, `secret_config`
-- the secret ones as one encrypted JSON object.
CREATE TABLE IF NOT EXISTS "game_servers" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id"       uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "server_id"        uuid REFERENCES "servers"("id") ON DELETE SET NULL,
  "name"             varchar(41) NOT NULL,
  "game_id"          varchar(64) NOT NULL,
  "game_name"        varchar(100) NOT NULL,
  "spec_version"     varchar(50) NOT NULL,
  "spec"             jsonb NOT NULL,
  "image"            varchar(500) NOT NULL,
  "config"           jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secret_config"    text,
  "memory_mb"        integer NOT NULL,
  "cpu_millicores"   integer,
  "container_id"     varchar(100),
  "status"           varchar(20) DEFAULT 'idle' NOT NULL,
  "status_message"   text,
  "backup_enabled"   boolean DEFAULT false NOT NULL,
  "backup_cron"      varchar(100),
  "backup_retention" integer DEFAULT 7 NOT NULL,
  "created_at"       timestamp DEFAULT now() NOT NULL,
  "updated_at"       timestamp DEFAULT now() NOT NULL
);

-- The container is named after the server, and container names are global
-- on the daemon.
CREATE UNIQUE INDEX IF NOT EXISTS "game_servers_name_uq"
  ON "game_servers" ("name");
CREATE INDEX IF NOT EXISTS "game_servers_project_idx"
  ON "game_servers" ("project_id");

-- Host ports allocated to game servers. A row stays while the server exists,
-- running or not, so a stopped server keeps its address. The unique index is
-- what prevents two servers from being handed the same port.
CREATE TABLE IF NOT EXISTS "game_server_ports" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_server_id"  uuid NOT NULL REFERENCES "game_servers"("id") ON DELETE CASCADE,
  "server_key"      varchar(64) DEFAULT 'local' NOT NULL,
  "name"            varchar(64) NOT NULL,
  "protocol"        varchar(3) NOT NULL,
  "container_port"  integer NOT NULL,
  "host_port"       integer NOT NULL
);

ALTER TABLE "game_server_ports"
  DROP CONSTRAINT IF EXISTS "game_server_ports_protocol_check";

ALTER TABLE "game_server_ports"
  ADD CONSTRAINT "game_server_ports_protocol_check"
  CHECK ("protocol" IN ('tcp', 'udp'));

CREATE UNIQUE INDEX IF NOT EXISTS "game_server_ports_uq"
  ON "game_server_ports" ("server_key", "host_port", "protocol");
CREATE INDEX IF NOT EXISTS "game_server_ports_server_idx"
  ON "game_server_ports" ("game_server_id");

-- World backups. Restore and delete address a backup by row id; the file name
-- is derived server-side and never taken from a caller.
CREATE TABLE IF NOT EXISTS "game_server_backups" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_server_id"  uuid NOT NULL REFERENCES "game_servers"("id") ON DELETE CASCADE,
  "filename"        varchar(255) NOT NULL,
  "size_bytes"      bigint,
  "status"          varchar(20) DEFAULT 'running' NOT NULL,
  "trigger"         varchar(20) NOT NULL,
  "triggered_by"    uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "error"           text,
  "started_at"      timestamp DEFAULT now() NOT NULL,
  "finished_at"     timestamp
);

CREATE INDEX IF NOT EXISTS "game_server_backups_server_idx"
  ON "game_server_backups" ("game_server_id", "started_at" DESC);
