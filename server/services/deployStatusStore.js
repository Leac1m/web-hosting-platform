import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { deployStatuses } from '../db/schema.js'

const isTestEnv =
  process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID)
const testStatusMap = new Map()

const normalizeRow = (row) => {
  if (!row) {
    return null
  }

  return {
    project: row.project,
    ownerLogin: row.ownerLogin || undefined,
    status: row.status,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt || null,
    repo: row.repo || undefined,
    branch: row.branch || undefined,
    hostingTarget: row.hostingTarget || undefined,
    providerStatus: row.providerStatus || undefined,
    hostingUrl: row.hostingUrl || undefined,
    providerUrl: row.providerUrl || undefined,
    reason: row.reason || undefined,
    pagesConfigured:
      typeof row.pagesConfigured === 'boolean' ? row.pagesConfigured : undefined,
    pagesSource: row.pagesSource || undefined,
    pagesConfigStatus: row.pagesConfigStatus || undefined,
    pagesLastCheckedAt:
      row.pagesLastCheckedAt?.toISOString?.() || row.pagesLastCheckedAt || undefined,
  }
}

const toDateOrNull = (value) => {
  if (!value) {
    return null
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

export async function setDeployStatus(project, status, details = {}) {
  const nextStatus = {
    project,
    status,
    updatedAt: new Date().toISOString(),
    ...details,
  }

  if (isTestEnv) {
    testStatusMap.set(project, nextStatus)
    return
  }

  const db = getDb()
  const values = {
    project: nextStatus.project,
    ownerLogin: nextStatus.ownerLogin ?? null,
    status: nextStatus.status,
    updatedAt: new Date(nextStatus.updatedAt),
    repo: nextStatus.repo ?? null,
    branch: nextStatus.branch ?? null,
    hostingTarget: nextStatus.hostingTarget ?? null,
    providerStatus: nextStatus.providerStatus ?? null,
    hostingUrl: nextStatus.hostingUrl ?? null,
    providerUrl: nextStatus.providerUrl ?? null,
    reason: nextStatus.reason ?? null,
    pagesConfigured:
      typeof nextStatus.pagesConfigured === 'boolean'
        ? nextStatus.pagesConfigured
        : null,
    pagesSource: nextStatus.pagesSource ?? null,
    pagesConfigStatus: nextStatus.pagesConfigStatus ?? null,
    pagesLastCheckedAt: toDateOrNull(nextStatus.pagesLastCheckedAt),
  }

  await db
    .insert(deployStatuses)
    .values(values)
    .onConflictDoUpdate({
      target: deployStatuses.project,
      set: {
        ownerLogin: values.ownerLogin,
        status: values.status,
        updatedAt: values.updatedAt,
        repo: values.repo,
        branch: values.branch,
        hostingTarget: values.hostingTarget,
        providerStatus: values.providerStatus,
        hostingUrl: values.hostingUrl,
        providerUrl: values.providerUrl,
        reason: values.reason,
        pagesConfigured: values.pagesConfigured,
        pagesSource: values.pagesSource,
        pagesConfigStatus: values.pagesConfigStatus,
        pagesLastCheckedAt: values.pagesLastCheckedAt,
      },
    })
}

export async function getDeployStatus(project) {
  if (isTestEnv) {
    return testStatusMap.get(project) || null
  }

  const db = getDb()
  const rows = await db
    .select()
    .from(deployStatuses)
    .where(eq(deployStatuses.project, project))
    .limit(1)

  return normalizeRow(rows[0])
}

export async function getAllDeployStatuses() {
  if (isTestEnv) {
    return Array.from(testStatusMap.values())
  }

  const db = getDb()
  const rows = await db
    .select()
    .from(deployStatuses)
    .orderBy(desc(deployStatuses.updatedAt))

  return rows.map(normalizeRow)
}

export function getProjectNameFromRepo(repo) {
  if (!repo || typeof repo !== 'string') {
    return null
  }

  return repo.replace('/', '-')
}

export function getProjectNameFromRepoAndBranch(repo, branch = 'main') {
  if (!repo || typeof repo !== 'string') {
    return null
  }

  const baseProjectName = repo.replace('/', '-')
  const normalizedBranch = String(branch || 'main')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')

  if (!normalizedBranch || normalizedBranch === 'main') {
    return baseProjectName
  }

  return `${baseProjectName}--${normalizedBranch}`
}
