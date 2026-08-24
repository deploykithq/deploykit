-- Per-service disk usage: the container's writable layer plus its volumes,
-- collected every 5 minutes by the disk scheduler and carried forward onto
-- each 30s metric sample. DEFAULT 0 keeps existing rows valid.
ALTER TABLE "metric_samples"
  ADD COLUMN IF NOT EXISTS "disk_used" bigint NOT NULL DEFAULT 0;
