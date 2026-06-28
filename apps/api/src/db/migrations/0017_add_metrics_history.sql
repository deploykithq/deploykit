-- Historical observability: durable, downsampled metric storage + opt-in public status pages.
--
-- metric_samples holds long-term metric history (the live 30-min window stays in Redis).
--   resolution '1m' rows are written once per minute by the rollup scheduler and kept 48h;
--   rows older than 48h are compacted into '1h' rows (kept HISTORY_RETENTION_DAYS, default 90).
--   net_rx/net_tx are cumulative byte counters at the bucket's close (diff to get throughput).
CREATE TABLE IF NOT EXISTS "metric_samples" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_id"   uuid NOT NULL,
  "service_type" varchar(20) NOT NULL,
  "resolution"   varchar(4) NOT NULL,
  "bucket"       timestamp NOT NULL,
  "cpu_avg"      real NOT NULL,
  "cpu_max"      real NOT NULL,
  "mem_avg"      real NOT NULL,
  "mem_max"      real NOT NULL,
  "mem_used"     bigint NOT NULL,
  "net_rx"       bigint NOT NULL,
  "net_tx"       bigint NOT NULL,
  "samples"      integer NOT NULL,
  "created_at"   timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "metric_samples_bucket_uq"
  ON "metric_samples" ("service_id", "resolution", "bucket");

CREATE INDEX IF NOT EXISTS "metric_samples_lookup_idx"
  ON "metric_samples" ("service_id", "resolution", "bucket");

-- Public status page configuration (opt-in per project).
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "status_page_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "status_page_slug"    varchar(80),
  ADD COLUMN IF NOT EXISTS "status_page_title"   varchar(255);

-- One status page per slug across enabled projects.
CREATE UNIQUE INDEX IF NOT EXISTS "projects_status_page_slug_uq"
  ON "projects" ("status_page_slug")
  WHERE "status_page_slug" IS NOT NULL;

-- Per-application opt-in to appear on the project's public status page.
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "status_page_visible" boolean NOT NULL DEFAULT false;
