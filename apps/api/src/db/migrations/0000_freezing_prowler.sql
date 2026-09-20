-- Initial schema.
--
-- Every statement is idempotent: this file is replayed from the start against
-- databases whose schema already exists (see the migration notes in CLAUDE.md),
-- so a bare CREATE TABLE here would abort the whole run with 42P07.
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" varchar(100) DEFAULT 'root' NOT NULL,
	"ssh_key_path" varchar(500),
	"is_local" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'disconnected' NOT NULL,
	"last_health_check" timestamp,
	"total_cpu" integer,
	"total_memory" bigint,
	"total_disk" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"source_type" varchar(20) DEFAULT 'github' NOT NULL,
	"repository_url" varchar(500),
	"branch" varchar(100) DEFAULT 'main' NOT NULL,
	"build_type" varchar(20) DEFAULT 'nixpacks' NOT NULL,
	"dockerfile_path" varchar(255) DEFAULT './Dockerfile',
	"build_args" jsonb,
	"env_vars" text,
	"port" integer,
	"server_id" uuid,
	"status" varchar(20) DEFAULT 'idle' NOT NULL,
	"container_id" varchar(100),
	"container_image" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"version" varchar(50),
	"internal_port" integer NOT NULL,
	"db_user" varchar(100),
	"db_password" text,
	"database_name" varchar(255),
	"container_id" varchar(100),
	"status" varchar(20) DEFAULT 'idle' NOT NULL,
	"server_id" uuid,
	"backup_enabled" boolean DEFAULT false NOT NULL,
	"backup_cron" varchar(100),
	"backup_retention" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"commit_hash" varchar(40),
	"commit_message" text,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"build_logs" text,
	"deploy_logs" text,
	"error_message" text,
	"image_name" varchar(500),
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"domain" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"https" boolean DEFAULT true NOT NULL,
	"certificate_resolver" varchar(50) DEFAULT 'letsencrypt',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each foreign key swallows its
-- own duplicate_object. This is the shape drizzle-kit itself emits.
DO $$ BEGIN
	ALTER TABLE "applications" ADD CONSTRAINT "applications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "applications" ADD CONSTRAINT "applications_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "databases" ADD CONSTRAINT "databases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "databases" ADD CONSTRAINT "databases_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "deployments" ADD CONSTRAINT "deployments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "domains" ADD CONSTRAINT "domains_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
