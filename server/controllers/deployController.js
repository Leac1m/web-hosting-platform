import fs from 'fs'
import path from 'path'
import * as tar from 'tar'
import { triggerBuild, GitHubError } from '../services/buildService.js'
import { validateRepoName } from '../services/pathValidator.js'
import { logEvent, logError } from '../services/logger.js'
import { updateRepositorySecrets } from '../services/githubAppAuth.js'
import {
  getAllDeployStatuses,
  getDeployStatus,
  getProjectNameFromRepo,
  setDeployStatus,
} from '../services/deployStatusStore.js'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET
const ALLOWED_HOSTING_TARGETS = new Set(['platform', 'github-pages'])

const isGitHubPagesEnabled = () => process.env.ENABLE_GITHUB_PAGES === 'true'

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

export const getDeploymentStatus = (req, res) => {
  const project = req.params.project
  const status = getDeployStatus(project)

  if (!status) {
    return res.status(404).json({ error: 'Deployment status not found' })
  }

  return res.json(status)
}

export const listDeployments = (req, res) => {
  const username = req.user?.login
  const allStatuses = getAllDeployStatuses()

  const ownedDeployments = filterStatusesForUser(allStatuses, username)

  return res.json(ownedDeployments)
}

export const listRouteMappings = (req, res) => {
  const username = req.user?.login
  const allStatuses = getAllDeployStatuses()
  const visibleStatuses = filterStatusesForUser(allStatuses, username)

  const mappings = visibleStatuses.map((status) => ({
    project: status.project,
    repo: status.repo || null,
    hostingTarget: status.hostingTarget || 'platform',
    hostingUrl: status.hostingUrl || `/sites/${status.project}/`,
    providerUrl: status.providerUrl || null,
    status: status.status,
    updatedAt: status.updatedAt,
  }))

  return res.json(mappings)
}

export const getPagesDeploymentStatus = (req, res) => {
  const project = req.params.project
  const status = getDeployStatus(project)

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
  const status = getDeployStatus(project)

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

export const triggerDeployment = async (req, res) => {
  const repo = req.body?.repo
  const branch = req.body?.branch || 'main'
  const hostingTarget = req.body?.hostingTarget || 'platform'
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
  const providerUrl =
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

    await triggerBuild(repo, branch, githubToken, { hostingTarget })

    setDeployStatus(projectName, 'queued', {
      repo,
      branch,
      hostingTarget,
      hostingUrl,
      providerUrl,
      providerStatus: 'queued',
    })
    logEvent('deploy_queued', {
      repo,
      branch,
      project: projectName,
      hostingTarget,
      hostingUrl,
      providerUrl,
    })

    return res.status(202).json({
      status: 'queued',
      repo,
      branch,
      hostingTarget,
      ...(hostingUrl ? { hostingUrl } : {}),
      ...(providerUrl ? { providerUrl } : {}),
    })
  } catch (err) {
    logError('deploy_trigger_failed', err, {
      repo,
      branch,
      project: projectName,
      hostingTarget,
    })
    setDeployStatus(projectName, 'failed', {
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
  setDeployStatus(projectName, 'upload_received', {
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

    setDeployStatus(projectName, 'live', {
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
    setDeployStatus(projectName, 'failed', {
      repo,
      commit,
      reason: err?.message || 'Unknown error',
    })

    res.status(500).json({
      error: 'Deployment failed',
    })
  }
}
