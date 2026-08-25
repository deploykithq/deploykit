-- SSH key catalogue: keys become a first-class entity that servers reference,
-- instead of every server carrying its own copy of a private key.
--
-- private_key holds the AES-256-GCM blob (lib/encryption.ts); public_key is the
-- one-line OpenSSH form that goes in a server's authorized_keys; fingerprint is
-- the SHA256:<base64> that `ssh-keygen -lf` prints.
--
-- servers.ssh_key_content / ssh_key_path are migrated into this table and then
-- dropped by the TypeScript backfill in db/backfill/ssh-keys.backfill.ts, which
-- runs from migrate.ts — deriving the public key needs ENCRYPTION_KEY, so it
-- cannot be done in SQL.
CREATE TABLE IF NOT EXISTS "ssh_keys" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"        varchar(255) NOT NULL,
  "description" varchar(500),
  "type"        varchar(20) NOT NULL,
  "public_key"  text NOT NULL,
  "private_key" text NOT NULL,
  "fingerprint" varchar(100) NOT NULL,
  "created_by"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"  timestamp DEFAULT now() NOT NULL,
  "updated_at"  timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ssh_keys_fingerprint_idx" ON "ssh_keys" ("fingerprint");

-- RESTRICT: a key in use by a server cannot be deleted out from under it.
ALTER TABLE "servers"
  ADD COLUMN IF NOT EXISTS "ssh_key_id" uuid REFERENCES "ssh_keys"("id") ON DELETE RESTRICT;
