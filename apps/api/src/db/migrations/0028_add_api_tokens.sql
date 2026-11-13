-- API tokens: long-lived credentials for non-browser clients (MCP, scripts).
-- Only the SHA-256 of a token is stored.

CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      uuid NOT NULL,
  "name"         varchar(100) NOT NULL,
  "token_hash"   varchar(64) NOT NULL,
  "token_prefix" varchar(16) NOT NULL,
  "scope"        varchar(10) DEFAULT 'read' NOT NULL,
  "expires_at"   timestamp,
  "last_used_at" timestamp,
  "created_at"   timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "api_tokens"
    ADD CONSTRAINT "api_tokens_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "api_tokens"
    ADD CONSTRAINT "api_tokens_scope_check"
    CHECK ("scope" IN ('read', 'write'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_token_hash_idx"
  ON "api_tokens" ("token_hash");

CREATE INDEX IF NOT EXISTS "api_tokens_user_idx"
  ON "api_tokens" ("user_id");
