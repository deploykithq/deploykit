-- Per-app resource limits and horizontal replicas
--   cpu_limit:    CPU cap in millicores (null = unlimited). 1000 = 1 core.
--   memory_limit: memory cap in MB (null = unlimited).
--   replicas:     number of container instances behind Traefik load balancing.
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "cpu_limit"    integer,
  ADD COLUMN IF NOT EXISTS "memory_limit" integer,
  ADD COLUMN IF NOT EXISTS "replicas"     integer NOT NULL DEFAULT 1;
