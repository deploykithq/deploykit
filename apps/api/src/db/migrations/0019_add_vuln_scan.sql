-- Trivy image vulnerability scanning (advisory).
--
-- Per deployment we record the scan status and a JSON summary (severity counts +
-- top CVEs). Per application, scan_enabled is a nullable toggle: NULL inherits the
-- global SCAN_ENABLED default, true/false override it.
ALTER TABLE "deployments"
  ADD COLUMN IF NOT EXISTS "scan_status"      varchar(20),
  ADD COLUMN IF NOT EXISTS "scan_results"     jsonb,
  ADD COLUMN IF NOT EXISTS "scan_finished_at" timestamp;

ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "scan_enabled" boolean;
