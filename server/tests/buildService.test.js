import { jest } from '@jest/globals'

const mockAxios = {
  post: jest.fn(),
}

jest.unstable_mockModule('axios', () => ({
  default: mockAxios,
}))

const { triggerBuild, GitHubError } = await import('../services/buildService.js')

describe('buildService', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('successfully triggers build on valid request', async () => {
    mockAxios.post.mockResolvedValue({ status: 204 })

    await triggerBuild('owner/repo', 'main', 'gh-token')

    expect(mockAxios.post).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/actions/workflows/deploy.yml/dispatches',
      { ref: 'main' },
      {
        headers: {
          Authorization: 'Bearer gh-token',
          Accept: 'application/vnd.github+json',
        },
      }
    )
  })

  test('throws GitHubError on 401 unauthorized', async () => {
    mockAxios.post.mockRejectedValue({
      response: { status: 401, data: { message: 'Bad credentials' } },
    })

    await expect(triggerBuild('owner/repo', 'main', 'bad-token')).rejects.toThrow(
      GitHubError
    )
    await expect(triggerBuild('owner/repo', 'main', 'bad-token')).rejects.toMatchObject({
      statusCode: 401,
      githubError: 'authentication_failed',
    })
  })

  test('throws GitHubError on 403 forbidden', async () => {
    mockAxios.post.mockRejectedValue({
      response: { status: 403, data: { message: 'Forbidden' } },
    })

    await expect(triggerBuild('owner/repo', 'main', 'gh-token')).rejects.toThrow(
      GitHubError
    )
    await expect(triggerBuild('owner/repo', 'main', 'gh-token')).rejects.toMatchObject({
      statusCode: 403,
      githubError: 'permission_denied',
    })
  })

  test('throws GitHubError on 404 not found', async () => {
    mockAxios.post.mockRejectedValue({
      response: { status: 404, data: { message: 'Not Found' } },
    })

    await expect(triggerBuild('owner/repo', 'main', 'gh-token')).rejects.toThrow(
      GitHubError
    )
    await expect(triggerBuild('owner/repo', 'main', 'gh-token')).rejects.toMatchObject({
      statusCode: 404,
      githubError: 'not_found',
    })
  })

  test('throws GitHubError on 422 unprocessable entity', async () => {
    mockAxios.post.mockRejectedValue({
      response: { status: 422, data: { message: 'Invalid request' } },
    })

    await expect(
      triggerBuild('owner/repo', 'nonexistent-branch', 'gh-token')
    ).rejects.toThrow(GitHubError)
    await expect(
      triggerBuild('owner/repo', 'nonexistent-branch', 'gh-token')
    ).rejects.toMatchObject({
      statusCode: 422,
      githubError: 'invalid_ref',
    })
  })

  test('re-throws unrecognized errors', async () => {
    const networkError = new Error('Network timeout')
    mockAxios.post.mockRejectedValue(networkError)

    await expect(triggerBuild('owner/repo', 'main', 'gh-token')).rejects.toThrow(
      networkError
    )
  })
})
