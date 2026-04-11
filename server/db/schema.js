import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const deployStatuses = pgTable(
  'deploy_statuses',
  {
    project: text('project').primaryKey(),
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
    index('idx_deploy_statuses_repo').on(table.repo),
    index('idx_deploy_statuses_status').on(table.status),
  ],
)
