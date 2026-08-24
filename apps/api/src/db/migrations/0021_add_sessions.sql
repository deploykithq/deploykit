CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "ip" varchar(45),
  "user_agent" varchar(512),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp
);

CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at");
