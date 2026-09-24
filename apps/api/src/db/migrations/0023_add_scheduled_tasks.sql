-- Scheduled tasks and one-off commands.
--
-- A task belongs to exactly one service (application / Compose stack /
-- database), mirroring the polymorphic owner pattern `deployments` already
-- uses. `cron` is nullable on purpose: a task without one is a saved command
-- that only runs when somebody presses Run.
--
-- `task_runs` keeps its own owner columns as well as `task_id`, so an ad-hoc
-- run (no task) is still attributable to a service and still disappears with
-- it, and so history survives the deletion of the task that produced it
-- (`task_id` is SET NULL, with `task_name` kept as a snapshot).
CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "application_id"     uuid REFERENCES "applications"("id") ON DELETE CASCADE,
  "compose_service_id" uuid REFERENCES "compose_services"("id") ON DELETE CASCADE,
  "database_id"        uuid REFERENCES "databases"("id") ON DELETE CASCADE,
  "service_name"       varchar(100),
  "name"               varchar(255) NOT NULL,
  "command"            text NOT NULL,
  "cron"               varchar(100),
  "timezone"           varchar(64) DEFAULT 'UTC' NOT NULL,
  "enabled"            boolean DEFAULT true NOT NULL,
  "timeout_seconds"    integer DEFAULT 300 NOT NULL,
  "last_run_at"        timestamp,
  "last_status"        varchar(20),
  "created_at"         timestamp DEFAULT now() NOT NULL,
  "updated_at"         timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "scheduled_tasks"
  DROP CONSTRAINT IF EXISTS "scheduled_tasks_owner_check";

ALTER TABLE "scheduled_tasks"
  ADD CONSTRAINT "scheduled_tasks_owner_check"
  CHECK (num_nonnulls("application_id", "compose_service_id", "database_id") = 1);

-- A stack has many containers, so a stack task must name the service to run in.
ALTER TABLE "scheduled_tasks"
  DROP CONSTRAINT IF EXISTS "scheduled_tasks_service_name_check";

ALTER TABLE "scheduled_tasks"
  ADD CONSTRAINT "scheduled_tasks_service_name_check"
  CHECK ("compose_service_id" IS NULL OR "service_name" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "scheduled_tasks_application_idx"
  ON "scheduled_tasks" ("application_id");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_compose_idx"
  ON "scheduled_tasks" ("compose_service_id");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_database_idx"
  ON "scheduled_tasks" ("database_id");

CREATE TABLE IF NOT EXISTS "task_runs" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id"            uuid REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL,
  "task_name"          varchar(255),
  "application_id"     uuid REFERENCES "applications"("id") ON DELETE CASCADE,
  "compose_service_id" uuid REFERENCES "compose_services"("id") ON DELETE CASCADE,
  "database_id"        uuid REFERENCES "databases"("id") ON DELETE CASCADE,
  "service_name"       varchar(100),
  "command"            text NOT NULL,
  -- Snapshot, like `command`: an ad-hoc run has no task to read it from, and
  -- editing a task's timeout must not retime a run already in flight.
  "timeout_seconds"    integer DEFAULT 300 NOT NULL,
  "status"             varchar(20) DEFAULT 'running' NOT NULL,
  "exit_code"          integer,
  "output"             text,
  "output_truncated"   boolean DEFAULT false NOT NULL,
  "trigger"            varchar(20) NOT NULL,
  "triggered_by"       uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "container_id"       varchar(100),
  "started_at"         timestamp DEFAULT now() NOT NULL,
  "finished_at"        timestamp,
  "duration_ms"        integer
);

ALTER TABLE "task_runs"
  DROP CONSTRAINT IF EXISTS "task_runs_owner_check";

ALTER TABLE "task_runs"
  ADD CONSTRAINT "task_runs_owner_check"
  CHECK (num_nonnulls("application_id", "compose_service_id", "database_id") = 1);

CREATE INDEX IF NOT EXISTS "task_runs_task_idx"
  ON "task_runs" ("task_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "task_runs_application_idx"
  ON "task_runs" ("application_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "task_runs_compose_idx"
  ON "task_runs" ("compose_service_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "task_runs_database_idx"
  ON "task_runs" ("database_id", "started_at" DESC);
