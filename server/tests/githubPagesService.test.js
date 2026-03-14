import { jest } from '@jest/globals'

const mockRequest = jest.fn()
const mockGetInstallationOctokit = jest.fn()

jest.unstable_mockModule('../services/githubAppAuth.js', () => ({
  getInstallationOctokit: mockGetInstallationOctokit,
}))

const { getPagesConfig, ensurePagesWorkflow, GitHubPagesError } =
  await import('../services/githubPagesService.js')

describe('githubPagesService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetInstallationOctokit.mockResolvedValue({ request: mockRequest })
  })

  test('returns normalized config from pages pre-check', async () => {
    mockRequest.mockResolvedValue({
      data: {
        html_url: 'https://owner.github.io/repo/',
        build_type: 'workflow',
        https_certificate: { state: 'approved' },
        status: 'built',
      },
    })

    const result = await getPagesConfig('owner', 'repo')

    expect(result).toMatchObject({
      configured: true,
      providerUrl: 'https://owner.github.io/repo/',
      pagesSource: 'workflow',
      httpsCertificateState: 'approved',
      status: 'built',
    })
    expect(mockRequest).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/pages',
      expect.objectContaining({ owner: 'owner', repo: 'repo' }),
    )
  })

  test('enables pages when pre-check returns 404', async () => {
    mockRequest.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({
      data: {
        html_url: 'https://owner.github.io/repo/',
        build_type: 'workflow',
      },
    })

    const result = await ensurePagesWorkflow('owner', 'repo')

    expect(result).toMatchObject({
      action: 'enabled',
      pagesSource: 'workflow',
    })
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      'POST /repos/{owner}/{repo}/pages',
      expect.objectContaining({ build_type: 'workflow' }),
    )
  })

  test('updates pages when source is not workflow', async () => {
    mockRequest
      .mockResolvedValueOnce({
        data: {
          html_url: 'https://owner.github.io/repo/',
          build_type: 'legacy',
        },
      })
      .mockResolvedValueOnce({
        data: {
          html_url: 'https://owner.github.io/repo/',
          build_type: 'workflow',
        },
      })

    const result = await ensurePagesWorkflow('owner', 'repo')

    expect(result).toMatchObject({
      action: 'updated',
      pagesSource: 'workflow',
    })
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      'PUT /repos/{owner}/{repo}/pages',
      expect.objectContaining({ build_type: 'workflow' }),
    )
  })

  test('maps 422 to GitHubPagesError', async () => {
    mockRequest.mockRejectedValue({ status: 422 })

    await expect(getPagesConfig('owner', 'repo')).rejects.toThrow(
      GitHubPagesError,
    )
    await expect(getPagesConfig('owner', 'repo')).rejects.toMatchObject({
      statusCode: 422,
      code: 'pages_unprocessable',
    })
  })
})
