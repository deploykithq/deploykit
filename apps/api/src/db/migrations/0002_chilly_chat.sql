ALTER TABLE "applications" DROP CONSTRAINT "applications_server_id_servers_id_fk";
--> statement-breakpoint
ALTER TABLE "databases" DROP CONSTRAINT "databases_server_id_servers_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar(20) DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "ssh_key_content" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "docker_version" varchar(50);--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_admin";