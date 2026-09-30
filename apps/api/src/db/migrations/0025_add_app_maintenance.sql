-- Maintenance mode per application.
--
-- While maintenance_enabled is true, a dk-maint-<id> container carries
-- higher-priority Traefik routers for every domain of the app and answers
-- with a 503 page. maintenance_message is optional text shown on that page.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "maintenance_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "maintenance_message" text;
