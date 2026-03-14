import { jest } from '@jest/globals'

const mockGetInstallationTokenById = jest.fn()
const originalFetch = global.fetch

jest.unstable_mockModule('../services/githubAppAuth.js', () => ({
  getInstallationTokenById: mockGetInstallationTokenById,
}))

const {
  GitHubRepoError,
  __clearRepoCacheForTests,
  invalidateCacheForUser,
  listRepositories,
} = await import('../services/githubRepoService.js')

const createHeaders = (values = {}) => ({
  get: (key) => values[key.toLowerCase()] || null,
})

const createResponse = ({
  ok = true,
  status = 200,
  data = {},
  headers = {},
} = {}) => ({
  ok,
  status,
  headers: createHeaders(headers),
  json: async () => data,
})

describe('githubRepoService', () => {
  beforeEach(() => {
    __clearRepoCacheForTests()
    mockGetInstallationTokenById.mockReset()
    mockGetInstallationTokenById.mockResolvedValue('installation-token')
    global.fetch = jest.fn()
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  test('returns normalized repos and paginates with perPage', async () => {
    global.fetch.mockResolvedValue(
      createResponse({
        data: {
          repositories: [
            {
              id: 1,
              name: 'Repo-One',
              full_name: 'owner/Repo-One',
              private: true,
              description: 'First repo',
              html_url: 'https://github.com/owner/Repo-One',
              updated_at: '2026-01-01T00:00:00Z',
            },
            {
              id: 2,
              name: 'Repo-Two',
              full_name: 'owner/Repo-Two',
              private: false,
              description: null,
              html_url: 'https://github.com/owner/Repo-Two',
              updated_at: '2026-01-02T00:00:00Z',
            },
          ],
        },
      }),
    )

    const result = await listRepositories(123, 'owner', {
      page: 1,
      perPage: 1,
    })

    expect(result).toEqual({
      repositories: [
        {
          id: 1,
          name: 'Repo-One',
          full_name: 'owner/Repo-One',
          is_private: true,
          description: 'First repo',
          html_url: 'https://github.com/owner/Repo-One',
          last_updated: '2026-01-01T00:00:00Z',
        },
      ],
      pagination: {
        next_page: 2,
        has_more: true,
      },
    })
  })

  test('serves subsequent requests from cache within ttl', async () => {
    global.fetch.mockResolvedValue(
      createResponse({
        data: {
          repositories: [
            {
              id: 9,
              name: 'cache-me',
              full_name: 'owner/cache-me',
              private: false,
              description: null,
              html_url: 'https://github.com/owner/cache-me',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
        },
      }),
    )

    await listRepositories(123, 'owner', { page: 1, perPage: 30 })
    await listRepositories(123, 'owner', { page: 1, perPage: 30 })

    expect(mockGetInstallationTokenById).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('re-fetches after cache invalidation', async () => {
    global.fetch
      .mockResolvedValueOnce(
        createResponse({
          data: {
            repositories: [
              {
                id: 11,
                name: 'first',
                full_name: 'owner/first',
                private: false,
                description: null,
                html_url: 'https://github.com/owner/first',
                updated_at: '2026-01-01T00:00:00Z',
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          data: {
            repositories: [
              {
                id: 12,
                name: 'second',
                full_name: 'owner/second',
                private: false,
                description: null,
                html_url: 'https://github.com/owner/second',
                updated_at: '2026-01-02T00:00:00Z',
              },
            ],
          },
        }),
      )

    await listRepositories(123, 'owner', { page: 1, perPage: 30 })
    invalidateCacheForUser('owner')
    const second = await listRepositories(123, 'owner', { page: 1, perPage: 30 })

    expect(second.repositories[0].name).toBe('second')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  test('applies case-insensitive search filter', async () => {
    global.fetch.mockResolvedValue(
      createResponse({
        data: {
          repositories: [
            {
              id: 1,
              name: 'frontend-app',
              full_name: 'owner/frontend-app',
              private: false,
              description: null,
              html_url: 'https://github.com/owner/frontend-app',
              updated_at: '2026-01-01T00:00:00Z',
            },
            {
              id: 2,
              name: 'backend-api',
              full_name: 'owner/backend-api',
              private: false,
              description: null,
              html_url: 'https://github.com/owner/backend-api',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
        },
      }),
    )

    const result = await listRepositories(123, 'owner', {
      page: 1,
      perPage: 30,
      search: 'FRONTEND',
    })

    expect(result.repositories).toHaveLength(1)
    expect(result.repositories[0].name).toBe('frontend-app')
  })

  test('throws rate_limited on 403 with exhausted rate limit', async () => {
    global.fetch.mockResolvedValue(
      createResponse({
        ok: false,
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1760000000',
        },
      }),
    )

    await expect(
      listRepositories(123, 'owner', { page: 1, perPage: 30 }),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      statusCode: 429,
    })
  })

  test('throws app_uninstalled on 401', async () => {
    global.fetch.mockResolvedValue(
      createResponse({
        ok: false,
        status: 401,
      }),
    )

    await expect(
      listRepositories(123, 'owner', { page: 1, perPage: 30 }),
    ).rejects.toEqual(expect.any(GitHubRepoError))

    await expect(
      listRepositories(123, 'owner', { page: 1, perPage: 30 }),
    ).rejects.toMatchObject({
      code: 'app_uninstalled',
      statusCode: 410,
    })
  })

  test('throws installation_not_found on 404', async () => {
    global.fetch.mockResolvedValue(
      createResponse({
        ok: false,
        status: 404,
      }),
    )

    await expect(
      listRepositories(123, 'owner', { page: 1, perPage: 30 }),
    ).rejects.toMatchObject({
      code: 'installation_not_found',
      statusCode: 404,
    })
  })
})
