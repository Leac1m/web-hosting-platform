import { jest } from '@jest/globals'

const mockAxios = {
  post: jest.fn(),
}

const mockTriggerWorkflowWithApp = jest.fn()

jest.unstable_mockModule('axios', () => ({
  default: mockAxios,
}))

jest.unstable_mockModule('../services/githubAppAuth.js', () => ({
  triggerWorkflowWithApp: mockTriggerWorkflowWithApp,
}))

const { triggerBuild, GitHubError } = await import('../services/buildService.js')

describe('buildService', () => {
  const originalAppId = process.env.GITHUB_APP_ID

  afterEach(() => {
    jest.clearAllMocks()
    process.env.GITHUB_APP_ID = originalAppId
  })

  test('successfully triggers build with token fallback', async () => {
    delete process.env.GITHUB_APP_ID
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
    expect(mockTriggerWorkflowWithApp).not.toHaveBeenCalled()
  })

  test('successfully triggers build with GitHub App when configured', async () => {
    process.env.GITHUB_APP_ID = '123456'
    mockTriggerWorkflowWithApp.mockResolvedValue(undefined)

    await triggerBuild('owner/repo', 'main')

    expect(mockTriggerWorkflowWithApp).toHaveBeenCalledWith('owner', 'repo', 'main')
    expect(mockAxios.post).not.toHaveBeenCalled()
  })

  test('throws explicit error when no auth method is configured', async () => {
    delete process.env.GITHUB_APP_ID

    await expect(triggerBuild('owner/repo', 'main')).rejects.toThrow(GitHubError)
    await expect(triggerBuild('owner/repo', 'main')).rejects.toMatchObject({
      statusCode: 500,
      githubError: 'missing_auth_config',
    })
  })

  test('throws GitHubError on 401 unauthorized (token)', async () => {
    delete process.env.GITHUB_APP_ID
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

  test('throws GitHubError on 403 forbidden (app)', async () => {
    process.env.GITHUB_APP_ID = '123456'
    mockTriggerWorkflowWithApp.mockRejectedValue({ status: 403 })

    await expect(triggerBuild('owner/repo', 'main')).rejects.toThrow(GitHubError)
    await expect(triggerBuild('owner/repo', 'main')).rejects.toMatchObject({
      statusCode: 403,
      githubError: 'permission_denied',
    })
  })

  test('throws GitHubError on 404 not found (token)', async () => {
    delete process.env.GITHUB_APP_ID
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

  test('throws GitHubError on 422 unprocessable entity (token)', async () => {
    delete process.env.GITHUB_APP_ID
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
    delete process.env.GITHUB_APP_ID
    const networkError = new Error('Network timeout')
    mockAxios.post.mockRejectedValue(networkError)

    await expect(triggerBuild('owner/repo', 'main', 'gh-token')).rejects.toThrow(
      networkError
    )
  })

  test('re-throws unrecognized app errors', async () => {
    process.env.GITHUB_APP_ID = '123456'
    const appError = new Error('Unexpected app failure')
    mockTriggerWorkflowWithApp.mockRejectedValue(appError)

    await expect(triggerBuild('owner/repo', 'main')).rejects.toThrow(appError)
  })
})
