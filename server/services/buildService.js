import axios from "axios"
import { triggerWorkflowWithApp } from "./githubAppAuth.js"

const WORKFLOWS_BY_TARGET = {
  platform: 'deploy.yml',
  'github-pages': 'deploy-pages.yml',
}

export class GitHubError extends Error {
  constructor(message, statusCode, githubError) {
    super(message)
    this.statusCode = statusCode
    this.githubError = githubError
  }
}

function hasGitHubAppConfig() {
  return Boolean(process.env.GITHUB_APP_ID)
}

function mapGitHubError(err) {
  const status = err.response?.status || err.status

  if (status === 401) {
    return new GitHubError(
      "GitHub authentication failed",
      401,
      "authentication_failed"
    )
  }

  if (status === 403) {
    return new GitHubError(
      "No permission to access repo or workflow",
      403,
      "permission_denied"
    )
  }

  if (status === 404) {
    return new GitHubError(
      "Repository, workflow, or app installation not found",
      404,
      "not_found"
    )
  }

  if (status === 422) {
    return new GitHubError(
      "Invalid branch or repository reference",
      422,
      "invalid_ref"
    )
  }

  return err
}

function resolveWorkflowId(hostingTarget) {
  return WORKFLOWS_BY_TARGET[hostingTarget] || WORKFLOWS_BY_TARGET.platform
}

export async function triggerBuild(repo, branch, token = null, options = {}) {

  const hostingTarget = options.hostingTarget || 'platform'
  const workflowId = resolveWorkflowId(hostingTarget)

  const [owner, repoName] = repo.split("/")

  try {
    if (hasGitHubAppConfig()) {
      await triggerWorkflowWithApp(owner, repoName, branch, workflowId)
      return
    }

    if (!token) {
      throw new GitHubError(
        "Missing GitHub authentication configuration",
        500,
        "missing_auth_config"
      )
    }

    await axios.post(
      `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${workflowId}/dispatches`,
      {
        ref: branch
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        }
      }
    )
  } catch (err) {
    if (err instanceof GitHubError) {
      throw err
    }

    throw mapGitHubError(err)
  }

}