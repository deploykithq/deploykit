-- Deleting a server nulls the references instead of blocking, so both foreign
-- keys are re-created with ON DELETE set null.
ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "applications_server_id_servers_id_fk";
--> statement-breakpoint
ALTER TABLE "databases" DROP CONSTRAINT IF EXISTS "databases_server_id_servers_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar(20) DEFAULT 'viewer' NOT NULL;
--> statement-breakpoint
-- servers.ssh_key_content held the per-server private key until 0021 moved keys
-- into the ssh_keys catalogue and db/backfill/ssh-keys.backfill.ts dropped it.
-- Guarded on ssh_key_id so replaying this file cannot resurrect that column on a
-- database that has already migrated.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'servers' AND column_name = 'ssh_key_id'
	) THEN
		ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "ssh_key_content" text;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "docker_version" varchar(50);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "applications" ADD CONSTRAINT "applications_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "databases" ADD CONSTRAINT "databases_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_admin";
