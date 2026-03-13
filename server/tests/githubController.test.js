import request from 'supertest'
import fs from 'fs'
import { jest } from '@jest/globals'

const mockListRepositories = jest.fn()
const mockInvalidateCacheForUser = jest.fn()
const mockGetUserInstallation = jest.fn()

jest.unstable_mockModule('../services/githubRepoService.js', () => ({
  listRepositories: mockListRepositories,
  invalidateCacheForUser: mockInvalidateCacheForUser,
  GitHubRepoError: class GitHubRepoError extends Error {
    constructor(code, statusCode, extra = {}) {
      super(code)
      this.code = code
      this.statusCode = statusCode
      Object.assign(this, extra)
    }
  },
}))

jest.unstable_mockModule('../services/githubAppAuth.js', () => ({
  getAppOctokit: () => ({
    rest: {
      apps: {
        getUserInstallation: mockGetUserInstallation,
      },
    },
  }),
  getInstallationTokenById: jest.fn(),
  getInstallationToken: jest.fn(),
  getInstallationOctokit: jest.fn(),
  triggerWorkflowWithApp: jest.fn(),
  updateRepositorySecret: jest.fn(),
  updateRepositorySecrets: jest.fn(),
}))

describe('github controller routes', () => {
  let app

  beforeEach(async () => {
    jest.resetModules()

    delete process.env.GITHUB_WEBHOOK_SECRET

    mockListRepositories.mockReset()
    mockInvalidateCacheForUser.mockReset()
    mockGetUserInstallation.mockReset()

    mockGetUserInstallation.mockResolvedValue({
      data: { id: 789 },
    })

    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)

    const serverModule = await import('../server.js')
    app = serverModule.default
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('GET /api/github/repositories returns repositories and pagination', async () => {
    mockListRepositories.mockResolvedValue({
      repositories: [
        {
          id: 1,
          name: 'repo-a',
          full_name: 'owner/repo-a',
          is_private: false,
          description: null,
          html_url: 'https://github.com/owner/repo-a',
          last_updated: '2026-01-01T00:00:00Z',
        },
      ],
      pagination: {
        next_page: null,
        has_more: false,
      },
    })

    const response = await request(app).get('/api/github/repositories')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      repositories: expect.any(Array),
      pagination: expect.any(Object),
    })
  })

  test('returns 429 when service returns rate_limited', async () => {
    const { GitHubRepoError } = await import('../services/githubRepoService.js')

    mockListRepositories.mockRejectedValue(
      new GitHubRepoError('rate_limited', 429, {
        resetAt: '2026-03-13T10:00:00.000Z',
      }),
    )

    const response = await request(app).get('/api/github/repositories')

    expect(response.status).toBe(429)
    expect(response.body).toEqual({
      error: 'rate_limited',
      resetAt: '2026-03-13T10:00:00.000Z',
    })
  })

  test('returns 404 app_not_installed when lazy installation lookup is 404', async () => {
    const notFound = new Error('not found')
    notFound.status = 404
    mockGetUserInstallation.mockRejectedValue(notFound)

    const response = await request(app).get('/api/github/repositories')

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('app_not_installed')
    expect(response.body.installUrl).toBeTruthy()
    expect(mockListRepositories).not.toHaveBeenCalled()
  })

  test('clamps per_page to 100', async () => {
    mockListRepositories.mockResolvedValue({
      repositories: [],
      pagination: {
        next_page: null,
        has_more: false,
      },
    })

    const response = await request(app).get(
      '/api/github/repositories?page=1&per_page=999',
    )

    expect(response.status).toBe(200)
    expect(mockListRepositories).toHaveBeenCalledWith(
      789,
      'test-user',
      expect.objectContaining({
        page: 1,
        perPage: 100,
      }),
    )
  })

  test('webhook invalidates cache on installation_repositories event', async () => {
    const payload = {
      action: 'added',
      sender: {
        login: 'owner',
      },
    }

    const response = await request(app)
      .post('/webhooks/github')
      .set('x-github-event', 'installation_repositories')
      .set('content-type', 'application/json')
      .send(JSON.stringify(payload))

    expect(response.status).toBe(204)
    expect(mockInvalidateCacheForUser).toHaveBeenCalledWith('owner')
  })

  test('webhook returns 401 when secret is set and signature is missing', async () => {
    process.env.GITHUB_WEBHOOK_SECRET = 'secret'

    const response = await request(app)
      .post('/webhooks/github')
      .set('x-github-event', 'installation_repositories')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ action: 'added', sender: { login: 'owner' } }))

    expect(response.status).toBe(401)
  })
})
