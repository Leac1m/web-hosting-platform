import { jest } from '@jest/globals'

const mockGetInstallationOctokit = jest.fn()
const mockLogEvent = jest.fn()

jest.unstable_mockModule('../services/githubAppAuth.js', () => ({
  getInstallationOctokit: mockGetInstallationOctokit,
}))

jest.unstable_mockModule('../services/logger.js', () => ({
  logEvent: mockLogEvent,
}))

const {
  MANAGED_WORKFLOW_FILES,
  WorkflowInjectionError,
  loadTemplate,
  syncWorkflows,
} = await import('../services/workflowInjectionService.js')

const toBase64 = (value) => Buffer.from(value, 'utf8').toString('base64')

const makeOctokit = () => ({
  rest: {
    repos: {
      getContent: jest.fn(),
      createOrUpdateFileContents: jest.fn(),
    },
    git: {
      getRef: jest.fn(),
      createRef: jest.fn(),
    },
    pulls: {
      list: jest.fn(),
      create: jest.fn(),
    },
  },
})

describe('workflowInjectionService', () => {
  let octokit

  beforeEach(() => {
    octokit = makeOctokit()
    mockGetInstallationOctokit.mockResolvedValue(octokit)
    mockLogEvent.mockReset()
  })

  test('loads managed templates from local workflows directory', async () => {
    const template = await loadTemplate('deploy.yml')

    expect(template).toContain('# Managed by Web Hosting Platform')
    expect(template).toContain('# Template-Version: 1')
    expect(template).toContain('name: Build and Upload React App')
  })

  test('creates managed workflow files when they are missing', async () => {
    octokit.rest.repos.getContent.mockRejectedValue({ status: 404 })

    const result = await syncWorkflows({
      repo: 'owner/repo',
      mode: 'commit',
      files: MANAGED_WORKFLOW_FILES,
    })

    expect(result.status).toBe('synced')
    expect(result.changedFiles).toEqual([
      '.github/workflows/deploy.yml',
      '.github/workflows/deploy-pages.yml',
    ])
    expect(result.skippedFiles).toEqual([])
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(2)
  })

  test('updates changed managed workflow files', async () => {
    const unchangedTemplate = await loadTemplate('deploy-pages.yml')
    const outdatedManaged = [
      '# Managed by Web Hosting Platform',
      '# Template-Version: 1',
      'name: Older Workflow Name',
    ].join('\n')

    octokit.rest.repos.getContent.mockImplementation(async ({ path }) => {
      if (path === '.github/workflows/deploy.yml') {
        return {
          data: {
            sha: 'sha-deploy',
            content: toBase64(outdatedManaged),
          },
        }
      }

      return {
        data: {
          sha: 'sha-pages',
          content: toBase64(unchangedTemplate),
        },
      }
    })

    const result = await syncWorkflows({
      repo: 'owner/repo',
      mode: 'commit',
      files: MANAGED_WORKFLOW_FILES,
    })

    expect(result.status).toBe('synced')
    expect(result.changedFiles).toEqual(['.github/workflows/deploy.yml'])
    expect(result.skippedFiles).toEqual(['.github/workflows/deploy-pages.yml'])
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1)
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '.github/workflows/deploy.yml',
        sha: 'sha-deploy',
      }),
    )
  })

  test('skips unchanged files during idempotent sync', async () => {
    const deployTemplate = await loadTemplate('deploy.yml')
    const pagesTemplate = await loadTemplate('deploy-pages.yml')

    octokit.rest.repos.getContent.mockImplementation(async ({ path }) => {
      if (path === '.github/workflows/deploy.yml') {
        return {
          data: {
            sha: 'sha-deploy',
            content: toBase64(deployTemplate),
          },
        }
      }

      return {
        data: {
          sha: 'sha-pages',
          content: toBase64(pagesTemplate),
        },
      }
    })

    const result = await syncWorkflows({
      repo: 'owner/repo',
      mode: 'commit',
      files: MANAGED_WORKFLOW_FILES,
    })

    expect(result.status).toBe('no_changes')
    expect(result.changedFiles).toEqual([])
    expect(result.skippedFiles).toEqual([
      '.github/workflows/deploy.yml',
      '.github/workflows/deploy-pages.yml',
    ])
    expect(octokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled()
  })

  test('blocks unmanaged workflow overwrite without force', async () => {
    const unmanagedContent = ['name: User Workflow', 'on: [push]'].join('\n')

    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        sha: 'sha-user',
        content: toBase64(unmanagedContent),
      },
    })

    await expect(
      syncWorkflows({
        repo: 'owner/repo',
        mode: 'commit',
        files: ['deploy.yml'],
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'unmanaged_file',
    })

    expect(octokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled()
  })

  test('allows unmanaged overwrite when force=true', async () => {
    const unmanagedContent = ['name: User Workflow', 'on: [push]'].join('\n')

    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        sha: 'sha-user',
        content: toBase64(unmanagedContent),
      },
    })

    const result = await syncWorkflows({
      repo: 'owner/repo',
      mode: 'commit',
      files: ['deploy.yml'],
      force: true,
    })

    expect(result.status).toBe('synced')
    expect(result.changedFiles).toEqual(['.github/workflows/deploy.yml'])
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1)
  })

  test('throws validation error for unsupported file names', async () => {
    await expect(
      syncWorkflows({
        repo: 'owner/repo',
        mode: 'commit',
        files: ['custom.yml'],
      }),
    ).rejects.toBeInstanceOf(WorkflowInjectionError)
  })
})
