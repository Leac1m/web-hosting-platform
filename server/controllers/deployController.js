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

  if (!username) {
    return res.json(allStatuses)
  }

  const ownedDeployments = allStatuses.filter((item) =>
    item.repo?.toLowerCase().startsWith(`${username.toLowerCase()}/`)
  )

  return res.json(ownedDeployments)
}

export const triggerDeployment = async (req, res) => {
  const repo = req.body?.repo
  const branch = req.body?.branch || 'main'
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

  const projectName = getProjectNameFromRepo(repo)

  logEvent('deploy_requested', { repo, branch, project: projectName })

  try {
    // Update repository secrets if using GitHub App
    if (hasGitHubAppConfig) {
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

      logEvent('secrets_updated', { repo, project: projectName })
    }

    await triggerBuild(repo, branch, githubToken)

    setDeployStatus(projectName, 'queued', { repo, branch })
    logEvent('deploy_queued', { repo, branch, project: projectName })

    return res.status(202).json({
      status: 'queued',
      repo,
      branch,
    })
  } catch (err) {
    logError('deploy_trigger_failed', err, {
      repo,
      branch,
      project: projectName,
    })
    setDeployStatus(projectName, 'failed', {
      repo,
      branch,
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
  setDeployStatus(projectName, 'upload_received', { repo, commit })

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
