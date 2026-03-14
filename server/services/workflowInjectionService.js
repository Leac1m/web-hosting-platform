import { readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getInstallationOctokit } from './githubAppAuth.js'
import { logEvent } from './logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MANAGED_MARKER = '# Managed by Web Hosting Platform'
const TEMPLATE_VERSION = '1'
const TEMPLATE_VERSION_MARKER = `# Template-Version: ${TEMPLATE_VERSION}`
const DEFAULT_BASE_BRANCH = 'main'
const DEFAULT_MODE = 'commit'
const DEFAULT_COMMIT_MESSAGE = 'chore(ci): add managed deployment workflows'

const MANAGED_WORKFLOW_PATHS = {
  'deploy.yml': '.github/workflows/deploy.yml',
  'deploy-pages.yml': '.github/workflows/deploy-pages.yml',
}

export const MANAGED_WORKFLOW_FILES = Object.keys(MANAGED_WORKFLOW_PATHS)

export class WorkflowInjectionError extends Error {
  constructor(message, statusCode = 500, code = 'workflow_sync_failed') {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

const normalizeRepo = (repo) => {
  const [owner, repoName] = String(repo || '').split('/')

  if (!owner || !repoName) {
    return null
  }

  return { owner, repoName }
}

const normalizeContentForCompare = (content) =>
  String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trimEnd()

const toBase64 = (content) => Buffer.from(content, 'utf8').toString('base64')

const fromBase64 = (content) =>
  Buffer.from(String(content || '').replace(/\n/g, ''), 'base64').toString('utf8')

const isManagedWorkflowContent = (content) =>
  String(content || '').includes(MANAGED_MARKER)

const ensureManagedTemplateHeader = (content) => {
  const normalized = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const markers = `${MANAGED_MARKER}\n${TEMPLATE_VERSION_MARKER}`

  if (normalized.startsWith(markers)) {
    return normalized
  }

  return `${markers}\n${normalized.replace(/^\n+/, '')}`
}

const mapGitHubError = (error) => {
  const status = error?.status || error?.response?.status

  if (status === 401) {
    return new WorkflowInjectionError(
      'GitHub authentication failed',
      401,
      'authentication_failed',
    )
  }

  if (status === 403) {
    return new WorkflowInjectionError(
      'GitHub App must have Workflows:write and Contents:write',
      403,
      'missing_permission',
    )
  }

  if (status === 404) {
    return new WorkflowInjectionError(
      'Repository, installation, or workflow path not found',
      404,
      'not_found',
    )
  }

  if (status === 422) {
    return new WorkflowInjectionError(
      'Requested branch or repository reference is invalid',
      422,
      'invalid_reference',
    )
  }

  return new WorkflowInjectionError(
    error?.message || 'Workflow sync failed',
    500,
    'workflow_sync_failed',
  )
}

export async function loadTemplate(fileName) {
  const targetPath = MANAGED_WORKFLOW_PATHS[fileName]

  if (!targetPath) {
    throw new WorkflowInjectionError(
      `Unsupported managed workflow file: ${fileName}`,
      400,
      'invalid_file',
    )
  }

  const templatePath = resolve(__dirname, '../../workflows', fileName)
  const content = await readFile(templatePath, 'utf8')

  return ensureManagedTemplateHeader(content)
}

async function getRemoteWorkflowFile({ octokit, owner, repoName, targetPath, ref }) {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo: repoName,
      path: targetPath,
      ref,
    })

    if (Array.isArray(data) || !data?.content) {
      return null
    }

    return {
      path: targetPath,
      sha: data.sha,
      content: fromBase64(data.content),
    }
  } catch (error) {
    const status = error?.status || error?.response?.status

    if (status === 404) {
      return null
    }

    throw error
  }
}

async function upsertWorkflowFile({
  octokit,
  owner,
  repoName,
  branch,
  targetPath,
  content,
  sha,
}) {
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo: repoName,
    path: targetPath,
    message: DEFAULT_COMMIT_MESSAGE,
    content: toBase64(content),
    branch,
    ...(sha ? { sha } : {}),
  })
}

export async function syncWorkflows({
  repo,
  baseBranch = DEFAULT_BASE_BRANCH,
  mode = DEFAULT_MODE,
  files = MANAGED_WORKFLOW_FILES,
  force = false,
}) {
  const ownerRepo = normalizeRepo(repo)

  if (!ownerRepo) {
    throw new WorkflowInjectionError('Invalid repo format. Expected owner/repo', 400, 'invalid_repo')
  }

  if (mode !== 'commit') {
    throw new WorkflowInjectionError('Invalid mode. Allowed values: commit', 400, 'invalid_mode')
  }

  const normalizedFiles = [...new Set(files)]

  if (normalizedFiles.length === 0) {
    throw new WorkflowInjectionError('At least one workflow file is required', 400, 'invalid_file')
  }

  const invalidFiles = normalizedFiles.filter((fileName) => !MANAGED_WORKFLOW_PATHS[fileName])
  if (invalidFiles.length > 0) {
    throw new WorkflowInjectionError(
      `Unsupported workflow file(s): ${invalidFiles.join(', ')}`,
      400,
      'invalid_file',
    )
  }

  const { owner, repoName } = ownerRepo

  logEvent('workflow_sync_requested', {
    repo,
    mode,
    baseBranch,
    force,
    requestedFiles: normalizedFiles,
  })

  try {
    const octokit = await getInstallationOctokit(owner, repoName)
    const changeCandidates = []
    const skippedFiles = []

    for (const fileName of normalizedFiles) {
      const templateContent = await loadTemplate(fileName)
      const targetPath = MANAGED_WORKFLOW_PATHS[fileName]
      const remoteFile = await getRemoteWorkflowFile({
        octokit,
        owner,
        repoName,
        targetPath,
        ref: baseBranch,
      })

      if (
        remoteFile &&
        !force &&
        !isManagedWorkflowContent(remoteFile.content)
      ) {
        throw new WorkflowInjectionError(
          `Refusing to overwrite unmanaged file at ${targetPath}. Use force=true to override.`,
          409,
          'unmanaged_file',
        )
      }

      const sameAsTemplate =
        remoteFile &&
        normalizeContentForCompare(remoteFile.content) ===
          normalizeContentForCompare(templateContent)

      if (sameAsTemplate && !force) {
        skippedFiles.push(targetPath)
        continue
      }

      changeCandidates.push({
        targetPath,
        content: templateContent,
        sha: remoteFile?.sha,
      })
    }

    if (changeCandidates.length === 0) {
      logEvent('workflow_sync_skipped', {
        repo,
        mode,
        baseBranch,
        changedCount: 0,
        skippedCount: skippedFiles.length,
      })

      return {
        status: 'no_changes',
        repo,
        mode,
        changedFiles: [],
        skippedFiles,
      }
    }

    const branch = baseBranch

    for (const candidate of changeCandidates) {
      await upsertWorkflowFile({
        octokit,
        owner,
        repoName,
        branch,
        targetPath: candidate.targetPath,
        content: candidate.content,
        sha: candidate.sha,
      })
    }

    logEvent('workflow_sync_changed', {
      repo,
      mode,
      baseBranch,
      branch,
      changedCount: changeCandidates.length,
      skippedCount: skippedFiles.length,
    })

    return {
      status: 'synced',
      repo,
      mode,
      branch,
      changedFiles: changeCandidates.map((item) => item.targetPath),
      skippedFiles,
    }
  } catch (error) {
    const normalized =
      error instanceof WorkflowInjectionError ? error : mapGitHubError(error)

    logEvent('workflow_sync_failed', {
      repo,
      mode,
      baseBranch,
      code: normalized.code,
      error: normalized.message,
    })

    throw normalized
  }
}
