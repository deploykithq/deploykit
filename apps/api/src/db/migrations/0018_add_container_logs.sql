-- Persistent container logs: continuous, searchable runtime stdout/stderr history.
--
-- The log collector keeps a follow-stream open for every running container and
-- batches lines into this table (secrets redacted, Docker's timestamp prefix parsed
-- into the "timestamp" column). The live tail keeps streaming via Socket.IO.
-- service_id is polymorphic (application | database), like metric_samples — no FK.
-- Old rows are pruned by the log-cleanup scheduler (LOG_RETENTION_DAYS, default 7).
CREATE TABLE IF NOT EXISTS "container_logs" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_id"   uuid NOT NULL,
  "service_type" varchar(20) NOT NULL,
  "container_id" varchar(100) NOT NULL,
  "stream"       varchar(8),
  "level"        varchar(10),
  "message"      text NOT NULL,
  "timestamp"    timestamp NOT NULL,
  "created_at"   timestamp NOT NULL DEFAULT now()
);

-- Dominant query: a service's logs over a time range, newest first.
CREATE INDEX IF NOT EXISTS "container_logs_lookup_idx"
  ON "container_logs" ("service_id", "timestamp");

-- Filter by severity within a service.
CREATE INDEX IF NOT EXISTS "container_logs_level_idx"
  ON "container_logs" ("service_id", "level");
