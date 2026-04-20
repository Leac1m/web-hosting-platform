import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    githubLogin: text('github_login').notNull(),
    githubId: integer('github_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_users_github_login').on(table.githubLogin)],
)

export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    branch: text('branch').notNull().default('main'),
    projectSlug: text('project_slug').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_projects_user_repo_branch').on(
      table.userId,
      table.repo,
      table.branch,
    ),
    index('idx_projects_user_id').on(table.userId),
    index('idx_projects_slug').on(table.projectSlug),
  ],
)

export const deployments = pgTable(
  'deployments',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    hostingTarget: text('hosting_target').notNull().default('github-pages'),
    hostingUrl: text('hosting_url'),
    providerUrl: text('provider_url'),
    providerStatus: text('provider_status'),
    reason: text('reason'),
    pagesConfigured: boolean('pages_configured'),
    pagesSource: text('pages_source'),
    pagesConfigStatus: text('pages_config_status'),
    pagesLastCheckedAt: timestamp('pages_last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_deployments_project_id').on(table.projectId),
    index('idx_deployments_status').on(table.status),
    index('idx_deployments_updated_at').on(table.updatedAt),
  ],
)

export const domains = pgTable(
  'domains',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    status: text('status').notNull().default('pending'),
    isPrimary: boolean('is_primary').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_domains_project_domain').on(table.projectId, table.domain),
    index('idx_domains_project_id').on(table.projectId),
  ],
)

export const envVars = pgTable(
  'env_vars',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueEncrypted: text('value_encrypted'),
    scope: text('scope').notNull().default('runtime'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_env_vars_project_key').on(table.projectId, table.key),
    index('idx_env_vars_project_id').on(table.projectId),
  ],
)

export const buildJobs = pgTable(
  'build_jobs',
  {
    id: serial('id').primaryKey(),
    deploymentId: integer('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    providerJobId: text('provider_job_id'),
    status: text('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_build_jobs_deployment').on(table.deploymentId),
    index('idx_build_jobs_status').on(table.status),
  ],
)

export const deployStatuses = pgTable(
  'deploy_statuses',
  {
    project: text('project').primaryKey(),
    ownerLogin: text('owner_login'),
    status: text('status').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    repo: text('repo'),
    branch: text('branch'),
    hostingTarget: text('hosting_target'),
    providerStatus: text('provider_status'),
    hostingUrl: text('hosting_url'),
    providerUrl: text('provider_url'),
    reason: text('reason'),
    pagesConfigured: boolean('pages_configured'),
    pagesSource: text('pages_source'),
    pagesConfigStatus: text('pages_config_status'),
    pagesLastCheckedAt: timestamp('pages_last_checked_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_deploy_statuses_owner_login').on(table.ownerLogin),
    index('idx_deploy_statuses_repo').on(table.repo),
    index('idx_deploy_statuses_status').on(table.status),
  ],
)
