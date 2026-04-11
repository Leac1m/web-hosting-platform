import fs from 'fs'
import path from 'path'
import * as tar from 'tar'
import { triggerBuild, GitHubError } from '../services/buildService.js'
import { validateRepoName } from '../services/pathValidator.js'
import { logEvent, logError } from '../services/logger.js'
import { updateRepositorySecrets } from '../services/githubAppAuth.js'
import {
  ensurePagesWorkflow,
  getPagesConfig as fetchPagesConfig,
  GitHubPagesError,
} from '../services/githubPagesService.js'
import {
  MANAGED_WORKFLOW_FILES,
  WorkflowInjectionError,
  syncWorkflows,
} from '../services/workflowInjectionService.js'
import {
  getAllDeployStatuses,
  getDeployStatus,
  getProjectNameFromRepo,
  setDeployStatus,
} from '../services/deployStatusStore.js'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET
const ALLOWED_HOSTING_TARGETS = new Set(['platform', 'github-pages'])
const ALLOWED_WORKFLOW_SYNC_MODES = new Set(['commit'])

const isGitHubPagesEnabled = () => process.env.ENABLE_GITHUB_PAGES !== 'false'
const isWorkflowInjectionEnabled = () =>
  process.env.ENABLE_WORKFLOW_INJECTION === 'true'

const getGitHubPagesUrl = (repo) => {
  const [owner, repoName] = repo.split('/')

  if (!owner || !repoName) {
    return null
  }

  if (repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io/`
  }

  return `https://${owner}.github.io/${repoName}/`
}

const getRelayHostingUrl = (projectName) => `/sites/${projectName}/`
const HEALTHCHECK_TIMEOUT_MS = 5000

const probeProviderAvailability = async (providerUrl) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS)

  try {
    const headResponse = await fetch(providerUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })

    if (headResponse.status !== 405) {
      return {
        available: headResponse.ok,
        upstreamStatus: headResponse.status,
      }
    }

    const getResponse = await fetch(providerUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    })

    return {
      available: getResponse.ok,
      upstreamStatus: getResponse.status,
    }
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'Health check timeout' : error?.message

    return {
      available: false,
      upstreamStatus: null,
      reason: reason || 'Failed to reach provider',
    }
  } finally {
    clearTimeout(timeout)
  }
}

const pathExists = (targetPath) => {
  try {
    fs.accessSync(targetPath)
    return true
  } catch {
    return false
  }
}

const isDirectory = (targetPath) => {
  try {
    return fs.statSync(targetPath).isDirectory()
  } catch {
    return false
  }
}

const moveDirectoryContents = (sourceDir, targetDir) => {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (pathExists(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    }

    fs.renameSync(sourcePath, targetPath)
  }
}

const normalizeDeployPath = (deployPath, projectName) => {
  const distPath = path.join(deployPath, 'dist')
  const distProjectPath = path.join(distPath, projectName)

  if (isDirectory(distProjectPath)) {
    moveDirectoryContents(distProjectPath, deployPath)
    fs.rmSync(distPath, { recursive: true, force: true })
    return
  }

  if (isDirectory(distPath)) {
    moveDirectoryContents(distPath, deployPath)
    fs.rmSync(distPath, { recursive: true, force: true })
  }
}

const filterStatusesForUser = (statuses, username) => {
  if (!username) {
    return statuses
  }

  return statuses.filter((item) =>
    item.repo?.toLowerCase().startsWith(`${username.toLowerCase()}/`)
  )
}

const parseOwnerRepo = (repo) => {
  const [owner, repoName] = String(repo || '').split('/')

  if (!owner || !repoName) {
    return null
  }

  return { owner, repoName }
}

const validateWorkflowSyncFiles = (files) => {
  if (files === undefined) {
    return {
      valid: true,
      files: MANAGED_WORKFLOW_FILES,
    }
  }

  if (!Array.isArray(files) || files.length === 0) {
    return {
      valid: false,
      error: 'files must be a non-empty array when provided',
    }
  }

  const normalizedFiles = [...new Set(files.map((entry) => String(entry || '').trim()))]
  const invalidFiles = normalizedFiles.filter((fileName) => !MANAGED_WORKFLOW_FILES.includes(fileName))

  if (invalidFiles.length > 0) {
    return {
      valid: false,
      error: `Unsupported workflow files: ${invalidFiles.join(', ')}`,
    }
  }

  return {
    valid: true,
    files: normalizedFiles,
  }
}

const getPagesConfigFromStatus = async (status, forceSync = false) => {
  const ownerRepo = parseOwnerRepo(status?.repo)

  if (!ownerRepo) {
    throw new GitHubPagesError('Invalid repository metadata for project', 422, 'invalid_repo')
  }

  if (forceSync) {
    return ensurePagesWorkflow(ownerRepo.owner, ownerRepo.repoName)
  }

  return fetchPagesConfig(ownerRepo.owner, ownerRepo.repoName)
}

export const getDeploymentStatus = async (req, res) => {
  const project = req.params.project
  const status = await getDeployStatus(project)

  if (!status) {
    return res.status(404).json({ error: 'Deployment status not found' })
  }

  return res.json(status)
}

export const listDeployments = async (req, res) => {
  const username = req.user?.login
  const allStatuses = await getAllDeployStatuses()

  const ownedDeployments = filterStatusesForUser(allStatuses, username)

  return res.json(ownedDeployments)
}

export const listRouteMappings = async (req, res) => {
  const username = req.user?.login
  const allStatuses = await getAllDeployStatuses()
  const visibleStatuses = filterStatusesForUser(allStatuses, username)

  const mappings = visibleStatuses.map((status) => ({
    project: status.project,
    repo: status.repo || null,
    hostingTarget: status.hostingTarget || 'github-pages',
    hostingUrl: status.hostingUrl || `/sites/${status.project}/`,
    providerUrl: status.providerUrl || null,
    status: status.status,
    updatedAt: status.updatedAt,
  }))

  return res.json(mappings)
}

export const getPagesDeploymentStatus = async (req, res) => {
  const project = req.params.project
  const status = await getDeployStatus(project)

  if (!status) {
    return res.status(404).json({ error: 'Deployment status not found' })
  }

  if (status.hostingTarget !== 'github-pages') {
    return res
      .status(404)
      .json({ error: 'No GitHub Pages deployment status for project' })
  }

  return res.json({
    project: status.project,
    repo: status.repo,
    branch: status.branch,
    hostingTarget: status.hostingTarget,
    providerStatus: status.providerStatus || status.status,
    hostingUrl: status.hostingUrl,
    providerUrl: status.providerUrl,
    status: status.status,
    updatedAt: status.updatedAt,
  })
}

export const getPagesProviderHealth = async (req, res) => {
  const project = req.params.project
  const status = await getDeployStatus(project)

  if (!status) {
    return res.status(404).json({ error: 'Deployment status not found' })
  }

  if (status.hostingTarget !== 'github-pages') {
    return res
      .status(404)
      .json({ error: 'No GitHub Pages deployment status for project' })
  }

  const providerUrl = status.providerUrl || getGitHubPagesUrl(status.repo)

  if (!providerUrl) {
    return res.status(422).json({ error: 'Unable to resolve GitHub Pages provider URL' })
  }

  const result = await probeProviderAvailability(providerUrl)
  const payload = {
    project: status.project,
    repo: status.repo,
    hostingTarget: status.hostingTarget,
    hostingUrl: status.hostingUrl,
    providerUrl,
    available: result.available,
    upstreamStatus: result.upstreamStatus,
    checkedAt: new Date().toISOString(),
    ...(result.reason ? { reason: result.reason } : {}),
  }

  if (!result.available) {
    return res.status(503).json(payload)
  }

  return res.json(payload)
}

export const getPagesConfig = async (req, res) => {
  const project = req.params.project
  const status = await getDeployStatus(project)

  if (!status) {
    return res.status(404).json({ error: 'Deployment status not found' })
  }

  if (status.hostingTarget !== 'github-pages') {
    return res
      .status(404)
      .json({ error: 'No GitHub Pages deployment status for project' })
  }

  if (!Boolean(process.env.GITHUB_APP_ID)) {
    return res
      .status(400)
      .json({ error: 'GitHub App configuration is required for Pages config retrieval' })
  }

  try {
    const config = await getPagesConfigFromStatus(status)

    await setDeployStatus(project, status.status, {
      ...status,
      providerUrl: config.providerUrl || status.providerUrl,
      pagesConfigured: true,
      pagesSource: config.pagesSource,
      pagesConfigStatus: 'ok',
      pagesLastCheckedAt: new Date().toISOString(),
    })

    return res.json({
      project: status.project,
      repo: status.repo,
      hostingTarget: status.hostingTarget,
      hostingUrl: status.hostingUrl,
      providerUrl: config.providerUrl || status.providerUrl,
      pagesConfigured: true,
      pagesSource: config.pagesSource,
      httpsCertificateState: config.httpsCertificateState,
      status: config.status,
      protectedDomainState: config.protectedDomainState,
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (error instanceof GitHubPagesError) {
      return res.status(error.statusCode || 500).json({ error: error.message })
    }

    return res.status(500).json({ error: 'Failed to fetch Pages config' })
  }
}

export const syncPagesConfig = async (req, res) => {
  const project = req.params.project
  const status = await getDeployStatus(project)

  if (!status) {
    return res.status(404).json({ error: 'Deployment status not found' })
  }

  if (status.hostingTarget !== 'github-pages') {
    return res
      .status(404)
      .json({ error: 'No GitHub Pages deployment status for project' })
  }

  if (!Boolean(process.env.GITHUB_APP_ID)) {
    return res
      .status(400)
      .json({ error: 'GitHub App configuration is required for Pages config sync' })
  }

  try {
    const config = await getPagesConfigFromStatus(status, true)

    await setDeployStatus(project, status.status, {
      ...status,
      providerUrl: config.providerUrl || status.providerUrl,
      pagesConfigured: true,
      pagesSource: config.pagesSource,
      pagesConfigStatus: 'ok',
      pagesLastCheckedAt: new Date().toISOString(),
    })

    return res.json({
      project: status.project,
      repo: status.repo,
      hostingTarget: status.hostingTarget,
      hostingUrl: status.hostingUrl,
      providerUrl: config.providerUrl || status.providerUrl,
      pagesConfigured: true,
      pagesSource: config.pagesSource,
      action: config.action || 'noop',
      syncedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (error instanceof GitHubPagesError) {
      return res.status(error.statusCode || 500).json({ error: error.message })
    }

    return res.status(500).json({ error: 'Failed to sync Pages config' })
  }
}

export const syncDeploymentWorkflows = async (req, res) => {
  if (!isWorkflowInjectionEnabled()) {
    return res.status(403).json({ error: 'Workflow injection is disabled' })
  }

  const repo = req.body?.repo
  const baseBranch = req.body?.baseBranch || 'main'
  const mode = req.body?.mode || 'commit'
  const force = req.body?.force === true
  const filesValidation = validateWorkflowSyncFiles(req.body?.files)

  if (!repo) {
    return res.status(400).json({ error: 'Missing repo name' })
  }

  if (!parseOwnerRepo(repo)) {
    return res.status(400).json({ error: 'Invalid repo format. Expected owner/repo' })
  }

  if (!ALLOWED_WORKFLOW_SYNC_MODES.has(mode)) {
    return res.status(400).json({ error: 'Invalid mode. Allowed values: commit' })
  }

  if (!filesValidation.valid) {
    return res.status(400).json({ error: filesValidation.error })
  }

  try {
    const result = await syncWorkflows({
      repo,
      baseBranch,
      mode,
      files: filesValidation.files,
      force,
    })

    const statusCode = result.status === 'no_changes' ? 200 : 202
    return res.status(statusCode).json(result)
  } catch (error) {
    if (error instanceof WorkflowInjectionError) {
      return res.status(error.statusCode || 500).json({
        error: 'Workflow sync failed',
        code: error.code,
        details: error.message,
      })
    }

    logError('workflow_sync_failed', error, {
      repo,
      baseBranch,
      mode,
    })

    return res.status(500).json({
      error: 'Workflow sync failed',
      code: 'workflow_sync_failed',
      details: 'Unexpected error while syncing workflows',
    })
  }
}

export const triggerDeployment = async (req, res) => {
  const repo = req.body?.repo
  const branch = req.body?.branch || 'main'
  const hostingTarget = req.body?.hostingTarget || 'github-pages'
  const hasGitHubAppConfig = Boolean(process.env.GITHUB_APP_ID)
  const githubToken = process.env.GITHUB_TOKEN

  if (!repo) {
    return res.status(400).json({ error: 'Missing repo name' })
  }

  if (!hasGitHubAppConfig && !githubToken) {
    return res
      .status(500)
      .json({ error: 'Missing GitHub authentication configuration' })
  }

  if (!ALLOWED_HOSTING_TARGETS.has(hostingTarget)) {
    return res.status(400).json({
      error: 'Invalid hostingTarget. Allowed values: platform, github-pages',
    })
  }

  if (hostingTarget === 'github-pages' && !isGitHubPagesEnabled()) {
    return res.status(403).json({
      error: 'GitHub Pages deployments are disabled',
    })
  }

  const projectName = getProjectNameFromRepo(repo)
  let providerUrl =
    hostingTarget === 'github-pages' ? getGitHubPagesUrl(repo) : undefined
  const hostingUrl =
    hostingTarget === 'github-pages'
      ? getRelayHostingUrl(projectName)
      : undefined

  logEvent('deploy_requested', {
    repo,
    branch,
    project: projectName,
    hostingTarget,
  })

  try {
    // Update repository secrets if using GitHub App
    if (hasGitHubAppConfig && hostingTarget === 'platform') {
      const [owner, repoName] = repo.split('/')
      const deployBackendUrl = process.env.DEPLOY_BACKEND_URL || 'http://localhost:3000'
      const deploySecret = process.env.DEPLOY_SECRET

      if (!deploySecret) {
        throw new Error('DEPLOY_SECRET not configured')
      }

      await updateRepositorySecrets(owner, repoName, {
        DEPLOY_BACKEND_URL: deployBackendUrl,
        DEPLOY_SECRET: deploySecret,
      })

      logEvent('secrets_updated', {
        repo,
        project: projectName,
        hostingTarget,
      })
    }

    let pagesConfig = null
    let workflowSync = null

    if (hostingTarget === 'github-pages' && hasGitHubAppConfig) {
      const ownerRepo = parseOwnerRepo(repo)

      if (!ownerRepo) {
        throw new GitHubPagesError('Invalid repository format for Pages auto configuration', 422, 'invalid_repo')
      }

      workflowSync = await syncWorkflows({
        repo,
        baseBranch: branch,
        mode: 'commit',
        files: MANAGED_WORKFLOW_FILES,
        force: false,
      })

      logEvent('workflow_sync_completed_for_deploy', {
        repo,
        branch,
        project: projectName,
        hostingTarget,
        workflowSyncStatus: workflowSync?.status || 'unknown',
        changedCount: workflowSync.changedFiles?.length || 0,
        skippedCount: workflowSync.skippedFiles?.length || 0,
      })

      pagesConfig = await ensurePagesWorkflow(ownerRepo.owner, ownerRepo.repoName)
      providerUrl = pagesConfig?.providerUrl || providerUrl

      logEvent('pages_sync_completed', {
        repo,
        project: projectName,
        hostingTarget,
        pagesSource: pagesConfig?.pagesSource,
        action: pagesConfig?.action,
        providerUrl,
      })
    }

    await triggerBuild(repo, branch, githubToken, { hostingTarget })

    await setDeployStatus(projectName, 'queued', {
      repo,
      branch,
      hostingTarget,
      hostingUrl,
      providerUrl,
      pagesConfigured: Boolean(pagesConfig),
      pagesSource: pagesConfig?.pagesSource,
      pagesConfigStatus: pagesConfig ? 'ok' : undefined,
      pagesLastCheckedAt: pagesConfig ? new Date().toISOString() : undefined,
      providerStatus: 'queued',
    })
    logEvent('deploy_queued', {
      repo,
      branch,
      project: projectName,
      hostingTarget,
      hostingUrl,
      providerUrl,
      pagesSource: pagesConfig?.pagesSource,
      pagesAction: pagesConfig?.action,
      workflowSyncStatus: workflowSync?.status,
    })

    return res.status(202).json({
      status: 'queued',
      repo,
      branch,
      hostingTarget,
      ...(hostingUrl ? { hostingUrl } : {}),
      ...(providerUrl ? { providerUrl } : {}),
      ...(pagesConfig?.pagesSource ? { pagesSource: pagesConfig.pagesSource } : {}),
      ...(pagesConfig?.action ? { pagesAction: pagesConfig.action } : {}),
      ...(workflowSync?.status ? { workflowSyncStatus: workflowSync.status } : {}),
    })
  } catch (err) {
    logError('deploy_trigger_failed', err, {
      repo,
      branch,
      project: projectName,
      hostingTarget,
    })
    await setDeployStatus(projectName, 'failed', {
      repo,
      branch,
      hostingTarget,
      providerStatus: 'failed',
      hostingUrl,
      providerUrl,
      reason: err?.message || 'Unknown error',
    })

    if (err instanceof GitHubError) {
      if (err.statusCode === 401) {
        return res.status(401).json({ error: 'GitHub authentication failed' })
      }
      if (err.statusCode === 403) {
        return res
          .status(403)
          .json({ error: 'No permission to access repo or workflow' })
      }
      if (err.statusCode === 404) {
        return res
          .status(404)
          .json({ error: 'Repository, workflow, or app installation not found' })
      }
      if (err.statusCode === 422) {
        return res
          .status(422)
          .json({ error: 'Invalid branch or repository reference' })
      }
    }

    if (err instanceof GitHubPagesError) {
      if (err.statusCode === 403) {
        return res.status(403).json({ error: err.message })
      }
      if (err.statusCode === 404) {
        return res.status(404).json({ error: err.message })
      }
      if (err.statusCode === 409) {
        return res.status(409).json({ error: err.message })
      }
      if (err.statusCode === 422) {
        return res.status(422).json({ error: err.message })
      }
    }

    return res.status(500).json({
      error: 'Failed to trigger deployment',
    })
  }
}

export const uploadArtifact = async (req, res) => {
  const authHeader = req.headers.authorization

  if (!authHeader || authHeader !== `Bearer ${DEPLOY_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const repo = req.body.repo
  const commit = req.body.commit

  if (!repo) {
    return res.status(400).json({ error: 'Missing repo name' })
  }

  const validation = validateRepoName(repo)
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error })
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Missing artifact file' })
  }

  const projectName = validation.projectName

  logEvent('artifact_received', { project: projectName, repo, commit })
  await setDeployStatus(projectName, 'upload_received', {
    repo,
    commit,
    hostingTarget: 'platform',
    providerStatus: 'building',
  })

  const deployPath = path.join(process.cwd(), 'deployments', projectName)

  fs.mkdirSync(deployPath, { recursive: true })

  try {
    await tar.x({
      file: req.file.path,
      cwd: deployPath,
    })

    normalizeDeployPath(deployPath, projectName)

    fs.unlinkSync(req.file.path)

    await setDeployStatus(projectName, 'live', {
      repo,
      commit,
      hostingTarget: 'platform',
      providerStatus: 'live',
      hostingUrl: `/sites/${projectName}/`,
      url: `/sites/${projectName}/`,
    })
    logEvent('deploy_live', {
      project: projectName,
      repo,
      commit,
      url: `/sites/${projectName}/`,
    })

    res.json({
      status: 'success',
      project: projectName,
      commit,
    })
  } catch (err) {
    logError('artifact_extract_failed', err, {
      project: projectName,
      repo,
      commit,
    })
    await setDeployStatus(projectName, 'failed', {
      repo,
      commit,
      reason: err?.message || 'Unknown error',
    })

    res.status(500).json({
      error: 'Deployment failed',
    })
  }
}
