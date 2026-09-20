-- users.is_admin becomes users.role ('admin' | 'operator' | 'viewer').
--
-- Replay-safe: the UPDATE is only reachable while the legacy boolean still
-- exists, so running this file again after the column is gone is a no-op.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar(20) DEFAULT 'viewer' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_admin'
	) THEN
		UPDATE "users" SET "role" = 'admin' WHERE "is_admin" = true;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_admin";
