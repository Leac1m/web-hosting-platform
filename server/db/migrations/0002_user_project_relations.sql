ALTER TABLE "deploy_statuses" ADD COLUMN IF NOT EXISTS "owner_login" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deploy_statuses_owner_login" ON "deploy_statuses" USING btree ("owner_login");--> statement-breakpoint

UPDATE "deploy_statuses"
SET "owner_login" = split_part("repo", '/', 1)
WHERE "owner_login" IS NULL
  AND "repo" IS NOT NULL
  AND "repo" LIKE '%/%';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "github_login" text NOT NULL,
  "github_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_github_login" ON "users" USING btree ("github_login");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "repo" text NOT NULL,
  "branch" text DEFAULT 'main' NOT NULL,
  "project_slug" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_projects_user_repo_branch" ON "projects" USING btree ("user_id", "repo", "branch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_user_id" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_slug" ON "projects" USING btree ("project_slug");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "deployments" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "status" text NOT NULL,
  "hosting_target" text DEFAULT 'github-pages' NOT NULL,
  "hosting_url" text,
  "provider_url" text,
  "provider_status" text,
  "reason" text,
  "pages_configured" boolean,
  "pages_source" text,
  "pages_config_status" text,
  "pages_last_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deployments_project_id" ON "deployments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deployments_status" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deployments_updated_at" ON "deployments" USING btree ("updated_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "domains" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "domain" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_domains_project_domain" ON "domains" USING btree ("project_id", "domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_domains_project_id" ON "domains" USING btree ("project_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "env_vars" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "key" text NOT NULL,
  "value_encrypted" text,
  "scope" text DEFAULT 'runtime' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_env_vars_project_key" ON "env_vars" USING btree ("project_id", "key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_env_vars_project_id" ON "env_vars" USING btree ("project_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "build_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "deployment_id" integer NOT NULL REFERENCES "deployments"("id") ON DELETE cascade,
  "provider_job_id" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_build_jobs_deployment" ON "build_jobs" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_build_jobs_status" ON "build_jobs" USING btree ("status");--> statement-breakpoint

INSERT INTO "users" ("github_login")
SELECT DISTINCT "owner_login"
FROM "deploy_statuses"
WHERE "owner_login" IS NOT NULL
ON CONFLICT ("github_login") DO NOTHING;--> statement-breakpoint

INSERT INTO "projects" ("user_id", "repo", "branch", "project_slug")
SELECT DISTINCT
  u."id",
  ds."repo",
  COALESCE(ds."branch", 'main') AS "branch",
  ds."project"
FROM "deploy_statuses" ds
JOIN "users" u ON u."github_login" = ds."owner_login"
WHERE ds."repo" IS NOT NULL
ON CONFLICT ("user_id", "repo", "branch") DO NOTHING;--> statement-breakpoint

INSERT INTO "deployments" (
  "project_id",
  "status",
  "hosting_target",
  "hosting_url",
  "provider_url",
  "provider_status",
  "reason",
  "pages_configured",
  "pages_source",
  "pages_config_status",
  "pages_last_checked_at",
  "created_at",
  "updated_at"
)
SELECT
  p."id",
  ds."status",
  COALESCE(ds."hosting_target", 'github-pages'),
  ds."hosting_url",
  ds."provider_url",
  ds."provider_status",
  ds."reason",
  ds."pages_configured",
  ds."pages_source",
  ds."pages_config_status",
  ds."pages_last_checked_at",
  ds."updated_at",
  ds."updated_at"
FROM "deploy_statuses" ds
JOIN "users" u ON u."github_login" = ds."owner_login"
JOIN "projects" p
  ON p."user_id" = u."id"
 AND p."repo" = ds."repo"
 AND p."branch" = COALESCE(ds."branch", 'main');--> statement-breakpoint

INSERT INTO "build_jobs" (
  "deployment_id",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  d."id",
  CASE
    WHEN d."status" IN ('failed') THEN 'failed'
    WHEN d."status" IN ('live', 'success') THEN 'succeeded'
    ELSE 'queued'
  END,
  d."updated_at",
  d."updated_at"
FROM "deployments" d
ON CONFLICT ("deployment_id") DO NOTHING;