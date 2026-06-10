-- Add per-application webhook secret (encrypted at rest). Used to authorize
-- the generic webhook endpoint; falls back to the global WEBHOOK_SECRET.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "webhook_secret" text;
