-- Horizontal autoscaling: scale replicas by average CPU/memory utilization.
--   autoscale_enabled:    master switch (requires a domain — replicas ride Traefik LB).
--   autoscale_min/max:    replica bounds the autoscaler stays within.
--   autoscale_cpu_target: target average CPU %; null = ignore CPU.
--                         Interpreted as % of cpu_limit when set, else % of one core.
--   autoscale_mem_target: target average memory %; null = ignore memory.
--   autoscale_cooldown:   seconds to wait after a scale action before the next one.
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "autoscale_enabled"    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoscale_min"        integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "autoscale_max"        integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "autoscale_cpu_target" integer,
  ADD COLUMN IF NOT EXISTS "autoscale_mem_target" integer,
  ADD COLUMN IF NOT EXISTS "autoscale_cooldown"   integer NOT NULL DEFAULT 180;
