CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" varchar(255),
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" uuid,
	"resource_name" varchar(255),
	"metadata" jsonb,
	"ip" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_type" varchar(20) NOT NULL,
	"service_id" uuid NOT NULL,
	"service_name" varchar(255),
	"metric" varchar(20) NOT NULL,
	"operator" varchar(5) NOT NULL,
	"threshold" integer NOT NULL,
	"channel" varchar(20) NOT NULL,
	"channel_config" jsonb,
	"cooldown_minutes" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"service_type" varchar(20) NOT NULL,
	"service_id" uuid NOT NULL,
	"service_name" varchar(255),
	"metric" varchar(20) NOT NULL,
	"value" real NOT NULL,
	"message" text NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"config" jsonb NOT NULL,
	"events" jsonb DEFAULT '["deploy.success","deploy.failed"]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "source_token" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "root_directory" varchar(255);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "start_command" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "volumes" jsonb;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_check_type" varchar(10) DEFAULT 'http' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_check_path" varchar(255) DEFAULT '/';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_check_timeout" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_check_interval" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_check_retries" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_check_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "preview_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "preview_domain" varchar(255);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "is_preview" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "parent_application_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "preview_pr_number" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "preview_branch" varchar(100);--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "replica_set" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alert_rules_service_idx" ON "alert_rules" USING btree ("service_type","service_id");--> statement-breakpoint
CREATE INDEX "alert_events_rule_idx" ON "alert_events" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_events_created_idx" ON "alert_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alert_events_service_idx" ON "alert_events" USING btree ("service_type","service_id");--> statement-breakpoint
CREATE INDEX "notif_channels_project_idx" ON "notification_channels" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_unique_idx" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");