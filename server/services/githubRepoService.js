import { getInstallationTokenById } from './githubAppAuth.js'

export class GitHubRepoError extends Error {
  constructor(code, statusCode, extra = {}) {
    super(code)
    this.code = code
    this.statusCode = statusCode
    Object.assign(this, extra)
  }
}

// Map<userLogin, { repos: RepoItem[], fetchedAt: number }>
const repoCache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_REPOS = 500
const PER_PAGE_FETCH = 100
const API_VERSION = '2022-11-28'

function normalizeRepo(raw) {
  return {
    id: raw.id,
    name: raw.name,
    full_name: raw.full_name,
    is_private: raw.private,
    description: raw.description ?? null,
    html_url: raw.html_url,
    last_updated: raw.updated_at,
  }
}

function isCacheFresh(entry) {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS
}

function parseHasNext(linkHeader) {
  if (!linkHeader) {
    return false
  }

  return linkHeader
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry.includes('rel="next"'))
}

function normalizeCacheKey(userLogin) {
  return String(userLogin || '').toLowerCase()
}

function toRateLimitReset(resetAt) {
  const asNumber = Number(resetAt)

  if (!Number.isFinite(asNumber)) {
    return null
  }

  return new Date(asNumber * 1000).toISOString()
}

async function fetchAllRepos(installationId, token) {
  const repos = []
  let page = 1
  let hasNext = true

  while (repos.length < MAX_REPOS && hasNext) {
    const url = `https://api.github.com/installation/repositories?per_page=${PER_PAGE_FETCH}&page=${page}`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
      },
    })

    if (!response.ok) {
      const rateLimitRemaining = response.headers.get('x-ratelimit-remaining')
      const resetAt = toRateLimitReset(response.headers.get('x-ratelimit-reset'))

      if (response.status === 401) {
        throw new GitHubRepoError('app_uninstalled', 410)
      }
      if (response.status === 404) {
        throw new GitHubRepoError('installation_not_found', 404)
      }
      if (response.status === 403 && rateLimitRemaining === '0') {
        throw new GitHubRepoError('rate_limited', 429, { resetAt })
      }

      throw new GitHubRepoError('github_request_failed', response.status || 502)
    }

    const data = await response.json()
    const batch = (data.repositories || []).map(normalizeRepo)
    repos.push(...batch)

    hasNext = parseHasNext(response.headers.get('link'))

    page++
  }

  return repos.slice(0, MAX_REPOS)
}

function applySearch(repos, search) {
  const query = String(search || '').trim().toLowerCase()

  if (!query) {
    return repos
  }

  return repos.filter((repo) => repo.name.toLowerCase().includes(query))
}

function paginate(repos, page, perPage) {
  const start = (page - 1) * perPage
  const end = start + perPage
  const slice = repos.slice(start, end)
  const hasMore = end < repos.length

  return {
    repositories: slice,
    pagination: {
      next_page: hasMore ? page + 1 : null,
      has_more: hasMore,
    },
  }
}

export async function listRepositories(
  installationId,
  userLogin,
  { page = 1, perPage = 30, search = '', bust = false } = {},
) {
  if (!installationId) {
    throw new GitHubRepoError('installation_not_found', 404)
  }

  const cacheKey = normalizeCacheKey(userLogin)
  const cached = bust ? null : repoCache.get(cacheKey)

  if (cached && isCacheFresh(cached) && !search) {
    return paginate(cached.repos, page, perPage)
  }

  const token = await getInstallationTokenById(installationId)
  const allRepos = await fetchAllRepos(installationId, token)

  repoCache.set(cacheKey, { repos: allRepos, fetchedAt: Date.now() })

  const filtered = applySearch(allRepos, search)
  return paginate(filtered, page, perPage)
}

export function __clearRepoCacheForTests() {
  repoCache.clear()
}

export function invalidateCacheForUser(userLogin) {
  repoCache.delete(normalizeCacheKey(userLogin))
}
