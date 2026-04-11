CREATE TABLE "deploy_statuses" (
	"project" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"repo" text,
	"branch" text,
	"hosting_target" text,
	"provider_status" text,
	"hosting_url" text,
	"provider_url" text,
	"reason" text,
	"pages_configured" boolean,
	"pages_source" text,
	"pages_config_status" text,
	"pages_last_checked_at" timestamp with time zone
);
