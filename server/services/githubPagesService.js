import { getInstallationOctokit } from './githubAppAuth.js'

const GITHUB_API_VERSION = '2022-11-28'

export class GitHubPagesError extends Error {
  constructor(message, statusCode, code) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

const pagesRequestHeaders = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': GITHUB_API_VERSION,
}

const mapPagesError = (error) => {
  const status = error?.status || error?.response?.status

  if (status === 401) {
    return new GitHubPagesError('GitHub authentication failed', 401, 'authentication_failed')
  }

  if (status === 403) {
    return new GitHubPagesError(
      'Missing required GitHub App permissions for Pages management',
      403,
      'permission_denied',
    )
  }

  if (status === 404) {
    return new GitHubPagesError(
      'Repository, installation, or Pages configuration endpoint not found',
      404,
      'not_found',
    )
  }

  if (status === 409) {
    return new GitHubPagesError(
      'GitHub Pages configuration conflict detected',
      409,
      'pages_conflict',
    )
  }

  if (status === 422) {
    return new GitHubPagesError(
      'GitHub Pages cannot be enabled for this repository configuration',
      422,
      'pages_unprocessable',
    )
  }

  return error
}

const normalizePagesConfig = (data) => ({
  configured: true,
  providerUrl: data?.html_url || null,
  pagesSource: data?.build_type || null,
  httpsCertificateState: data?.https_certificate?.state || null,
  cname: data?.cname || null,
  status: data?.status || null,
  protectedDomainState: data?.protected_domain_state || null,
  pendingDomainUnverifiedAt: data?.pending_domain_unverified_at || null,
  custom404: data?.custom_404 || false,
})

export const getPagesConfig = async (owner, repo) => {
  try {
    const octokit = await getInstallationOctokit(owner, repo)
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pages', {
      owner,
      repo,
      headers: pagesRequestHeaders,
    })

    return normalizePagesConfig(data)
  } catch (error) {
    throw mapPagesError(error)
  }
}

export const enablePagesWorkflow = async (owner, repo) => {
  try {
    const octokit = await getInstallationOctokit(owner, repo)
    const { data } = await octokit.request('POST /repos/{owner}/{repo}/pages', {
      owner,
      repo,
      build_type: 'workflow',
      headers: pagesRequestHeaders,
    })

    return normalizePagesConfig(data)
  } catch (error) {
    throw mapPagesError(error)
  }
}

export const updatePagesToWorkflow = async (owner, repo) => {
  try {
    const octokit = await getInstallationOctokit(owner, repo)
    const { data } = await octokit.request('PUT /repos/{owner}/{repo}/pages', {
      owner,
      repo,
      build_type: 'workflow',
      headers: pagesRequestHeaders,
    })

    return normalizePagesConfig(data)
  } catch (error) {
    throw mapPagesError(error)
  }
}

export const ensurePagesWorkflow = async (owner, repo) => {
  try {
    const config = await getPagesConfig(owner, repo)

    if (config.pagesSource === 'workflow') {
      return {
        ...config,
        action: 'noop',
      }
    }

    const updated = await updatePagesToWorkflow(owner, repo)

    return {
      ...updated,
      action: 'updated',
    }
  } catch (error) {
    if (error instanceof GitHubPagesError && error.statusCode === 404) {
      const enabled = await enablePagesWorkflow(owner, repo)

      return {
        ...enabled,
        action: 'enabled',
      }
    }

    throw error
  }
}
