import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { jest } from '@jest/globals'

const mockTarX = jest.fn()
const mockTriggerBuild = jest.fn()
const mockFetch = jest.fn()
const mockEnsurePagesWorkflow = jest.fn()
const mockGetPagesConfig = jest.fn()
const originalFetch = global.fetch

jest.unstable_mockModule('tar', () => ({
  x: mockTarX,
}))

jest.unstable_mockModule('../services/buildService.js', () => ({
  triggerBuild: mockTriggerBuild,
  GitHubError: class GitHubError extends Error {
    constructor(message, statusCode, githubError) {
      super(message)
      this.statusCode = statusCode
      this.githubError = githubError
    }
  },
}))

jest.unstable_mockModule('../services/githubPagesService.js', () => ({
  ensurePagesWorkflow: mockEnsurePagesWorkflow,
  getPagesConfig: mockGetPagesConfig,
  GitHubPagesError: class GitHubPagesError extends Error {
    constructor(message, statusCode, code) {
      super(message)
      this.statusCode = statusCode
      this.code = code
    }
  },
}))

describe('POST /deploy/upload', () => {
  let app

  beforeEach(async () => {
    jest.resetModules()

    process.env.DEPLOY_SECRET = 'test-secret'
    process.env.GITHUB_TOKEN = 'gh-token'
    delete process.env.GITHUB_APP_ID
    delete process.env.ENABLE_GITHUB_PAGES
    delete process.env.ENABLE_GITHUB_PAGES_AUTO_CONFIG

    mockTarX.mockReset()
    mockTriggerBuild.mockReset()
    mockFetch.mockReset()
    mockEnsurePagesWorkflow.mockReset()
    mockGetPagesConfig.mockReset()
    global.fetch = mockFetch

    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined)

    const serverModule = await import('../server.js')
    app = serverModule.default
  })

  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
  })

  describe('POST /deploy', () => {
    test('returns 404 for unknown deployment status', async () => {
      const response = await request(app).get('/deploy/status/unknown-project')

      expect(response.status).toBe(404)
      expect(response.body).toEqual({ error: 'Deployment status not found' })
    })

    test('returns 400 when repo is missing', async () => {
      const response = await request(app)
        .post('/deploy')
        .send({ branch: 'main' })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Missing repo name' })
      expect(mockTriggerBuild).not.toHaveBeenCalled()
    })

    test('returns 500 when GitHub auth config is missing', async () => {
      delete process.env.GITHUB_TOKEN
      delete process.env.GITHUB_APP_ID

      const response = await request(app)
        .post('/deploy')
        .send({ repo: 'owner/repo', branch: 'main' })

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ error: 'Missing GitHub authentication configuration' })
      expect(mockTriggerBuild).not.toHaveBeenCalled()
    })

    test('returns 202 and triggers build for valid request', async () => {
      mockTriggerBuild.mockResolvedValue(undefined)

      const response = await request(app)
        .post('/deploy')
        .send({ repo: 'owner/repo', branch: 'main' })

      expect(response.status).toBe(202)
      expect(response.body).toEqual({
        status: 'queued',
        repo: 'owner/repo',
        branch: 'main',
        hostingTarget: 'platform',
      })
      expect(mockTriggerBuild).toHaveBeenCalledWith(
        'owner/repo',
        'main',
        'gh-token',
        { hostingTarget: 'platform' },
      )

      const statusResponse = await request(app).get('/deploy/status/owner-repo')

      expect(statusResponse.status).toBe(200)
      expect(statusResponse.body).toMatchObject({
        project: 'owner-repo',
        status: 'queued',
        repo: 'owner/repo',
        branch: 'main',
      })
    })

    test('returns 500 when build trigger fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      mockTriggerBuild.mockRejectedValue(new Error('dispatch failed'))

      const response = await request(app)
        .post('/deploy')
        .send({ repo: 'owner/repo', branch: 'main' })

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ error: 'Failed to trigger deployment' })
    })

    test('returns 400 for unsupported hostingTarget', async () => {
      const response = await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'unknown-target',
        })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        error: 'Invalid hostingTarget. Allowed values: platform, github-pages',
      })
      expect(mockTriggerBuild).not.toHaveBeenCalled()
    })

    test('returns 403 when github-pages target is disabled', async () => {
      const response = await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      expect(response.status).toBe(403)
      expect(response.body).toEqual({
        error: 'GitHub Pages deployments are disabled',
      })
      expect(mockTriggerBuild).not.toHaveBeenCalled()
    })

    test('returns 202 and computes pages url for github-pages target', async () => {
      process.env.ENABLE_GITHUB_PAGES = 'true'
      mockTriggerBuild.mockResolvedValue(undefined)

      const response = await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      expect(response.status).toBe(202)
      expect(response.body).toEqual({
        status: 'queued',
        repo: 'owner/repo',
        branch: 'main',
        hostingTarget: 'github-pages',
        hostingUrl: '/sites/owner-repo/',
        providerUrl: 'https://owner.github.io/repo/',
      })
      expect(mockTriggerBuild).toHaveBeenCalledWith(
        'owner/repo',
        'main',
        'gh-token',
        { hostingTarget: 'github-pages' },
      )

      const statusResponse = await request(app).get('/deploy/pages-status/owner-repo')

      expect(statusResponse.status).toBe(200)
      expect(statusResponse.body).toMatchObject({
        project: 'owner-repo',
        repo: 'owner/repo',
        branch: 'main',
        hostingTarget: 'github-pages',
        providerStatus: 'queued',
        hostingUrl: '/sites/owner-repo/',
        providerUrl: 'https://owner.github.io/repo/',
      })
    })

    test('auto-configures pages via GitHub App before dispatch when enabled', async () => {
      process.env.ENABLE_GITHUB_PAGES = 'true'
      process.env.ENABLE_GITHUB_PAGES_AUTO_CONFIG = 'true'
      process.env.GITHUB_APP_ID = '123456'
      delete process.env.GITHUB_TOKEN
      mockTriggerBuild.mockResolvedValue(undefined)
      mockEnsurePagesWorkflow.mockResolvedValue({
        providerUrl: 'https://owner.github.io/repo/',
        pagesSource: 'workflow',
        action: 'enabled',
      })

      const response = await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      expect(response.status).toBe(202)
      expect(response.body).toMatchObject({
        hostingTarget: 'github-pages',
        providerUrl: 'https://owner.github.io/repo/',
        pagesSource: 'workflow',
        pagesAction: 'enabled',
      })
      expect(mockEnsurePagesWorkflow).toHaveBeenCalledWith('owner', 'repo')
      expect(mockTriggerBuild).toHaveBeenCalledWith(
        'owner/repo',
        'main',
        undefined,
        { hostingTarget: 'github-pages' },
      )
    })

    test('returns pages config details from GitHub app endpoint', async () => {
      process.env.ENABLE_GITHUB_PAGES = 'true'
      process.env.GITHUB_APP_ID = '123456'
      mockTriggerBuild.mockResolvedValue(undefined)
      mockGetPagesConfig.mockResolvedValue({
        providerUrl: 'https://owner.github.io/repo/',
        pagesSource: 'workflow',
        httpsCertificateState: 'approved',
        status: 'built',
        protectedDomainState: 'verified',
      })

      await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      const response = await request(app).get('/deploy/pages-config/owner-repo')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        project: 'owner-repo',
        providerUrl: 'https://owner.github.io/repo/',
        pagesConfigured: true,
        pagesSource: 'workflow',
        httpsCertificateState: 'approved',
      })
      expect(mockGetPagesConfig).toHaveBeenCalledWith('owner', 'repo')
    })

    test('sync endpoint forces pages workflow reconciliation', async () => {
      process.env.ENABLE_GITHUB_PAGES = 'true'
      process.env.GITHUB_APP_ID = '123456'
      mockTriggerBuild.mockResolvedValue(undefined)
      mockEnsurePagesWorkflow.mockResolvedValue({
        providerUrl: 'https://owner.github.io/repo/',
        pagesSource: 'workflow',
        action: 'updated',
      })

      await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      const response = await request(app).post('/deploy/pages-config/owner-repo/sync')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        project: 'owner-repo',
        pagesConfigured: true,
        pagesSource: 'workflow',
        action: 'updated',
      })
      expect(mockEnsurePagesWorkflow).toHaveBeenCalledWith('owner', 'repo')
    })

    test('returns pages provider health when upstream is reachable', async () => {
      process.env.ENABLE_GITHUB_PAGES = 'true'
      mockTriggerBuild.mockResolvedValue(undefined)

      await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      mockFetch.mockResolvedValue(
        new Response('', {
          status: 200,
        }),
      )

      const response = await request(app).get('/deploy/pages-health/owner-repo')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        project: 'owner-repo',
        hostingTarget: 'github-pages',
        hostingUrl: '/sites/owner-repo/',
        providerUrl: 'https://owner.github.io/repo/',
        available: true,
        upstreamStatus: 200,
      })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://owner.github.io/repo/',
        expect.objectContaining({ method: 'HEAD' }),
      )
    })

    test('returns 503 pages provider health when upstream is unreachable', async () => {
      process.env.ENABLE_GITHUB_PAGES = 'true'
      mockTriggerBuild.mockResolvedValue(undefined)

      await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      mockFetch.mockRejectedValue(new Error('network down'))

      const response = await request(app).get('/deploy/pages-health/owner-repo')

      expect(response.status).toBe(503)
      expect(response.body).toMatchObject({
        project: 'owner-repo',
        available: false,
        upstreamStatus: null,
        reason: 'network down',
      })
    })

    test('returns compact route mappings for visible deployments', async () => {
      process.env.ENABLE_GITHUB_PAGES = 'true'
      mockTriggerBuild.mockResolvedValue(undefined)

      await request(app)
        .post('/deploy')
        .send({
          repo: 'test-user/repo-platform',
          branch: 'main',
          hostingTarget: 'platform',
        })

      await request(app)
        .post('/deploy')
        .send({
          repo: 'test-user/repo-pages',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      const response = await request(app).get('/deploy/routes')

      expect(response.status).toBe(200)
      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            project: 'test-user-repo-platform',
            repo: 'test-user/repo-platform',
            hostingTarget: 'platform',
            hostingUrl: '/sites/test-user-repo-platform/',
            providerUrl: null,
          }),
          expect.objectContaining({
            project: 'test-user-repo-pages',
            repo: 'test-user/repo-pages',
            hostingTarget: 'github-pages',
            hostingUrl: '/sites/test-user-repo-pages/',
            providerUrl: 'https://test-user.github.io/repo-pages/',
          }),
        ]),
      )
    })

    test('returns 404 pages provider health for non-pages deployments', async () => {
      mockTriggerBuild.mockResolvedValue(undefined)

      await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'platform',
        })

      const response = await request(app).get('/deploy/pages-health/owner-repo')

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        error: 'No GitHub Pages deployment status for project',
      })
    })

    test('relays github-pages site via /sites/:project without mutating html', async () => {
      process.env.ENABLE_GITHUB_PAGES = 'true'
      mockTriggerBuild.mockResolvedValue(undefined)

      await request(app)
        .post('/deploy')
        .send({
          repo: 'owner/repo',
          branch: 'main',
          hostingTarget: 'github-pages',
        })

      mockFetch.mockResolvedValue(
        new Response(
          '<!doctype html><html><head></head><body><script src="/assets/app.js"></script></body></html>',
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        ),
      )

      const response = await request(app).get('/sites/owner-repo/')

      expect(response.status).toBe(200)
      expect(response.text).toBe(
        '<!doctype html><html><head></head><body><script src="/assets/app.js"></script></body></html>',
      )
      expect(mockFetch).toHaveBeenCalledWith(
        new URL('https://owner.github.io/repo/'),
        expect.objectContaining({ method: 'GET' }),
      )
    })

    test('returns 401 when GitHub token is invalid', async () => {
      const { GitHubError } = await import('../services/buildService.js')
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      mockTriggerBuild.mockRejectedValue(
        new GitHubError('Invalid token', 401, 'authentication_failed')
      )

      const response = await request(app)
        .post('/deploy')
        .send({ repo: 'owner/repo', branch: 'main' })

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ error: 'GitHub authentication failed' })
    })

    test('returns 403 when no permission to access repo', async () => {
      const { GitHubError } = await import('../services/buildService.js')
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      mockTriggerBuild.mockRejectedValue(
        new GitHubError('Permission denied', 403, 'permission_denied')
      )

      const response = await request(app)
        .post('/deploy')
        .send({ repo: 'owner/repo', branch: 'main' })

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ error: 'No permission to access repo or workflow' })
    })

    test('returns 404 when repo or workflow not found', async () => {
      const { GitHubError } = await import('../services/buildService.js')
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      mockTriggerBuild.mockRejectedValue(
        new GitHubError('Not found', 404, 'not_found')
      )

      const response = await request(app)
        .post('/deploy')
        .send({ repo: 'owner/repo', branch: 'main' })

      expect(response.status).toBe(404)
      expect(response.body).toEqual({ error: 'Repository, workflow, or app installation not found' })
    })

    test('returns 422 when branch ref is invalid', async () => {
      const { GitHubError } = await import('../services/buildService.js')
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      mockTriggerBuild.mockRejectedValue(
        new GitHubError('Invalid ref', 422, 'invalid_ref')
      )

      const response = await request(app)
        .post('/deploy')
        .send({ repo: 'owner/repo', branch: 'nonexistent-branch' })

      expect(response.status).toBe(422)
      expect(response.body).toEqual({ error: 'Invalid branch or repository reference' })
    })
  })

  test('returns 403 when auth is missing', async () => {
    const response = await request(app)
      .post('/deploy/upload')
      .field('repo', 'owner/repo')

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: 'Unauthorized' })
  })

  test('returns 403 when auth is invalid', async () => {
    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer wrong-secret')
      .field('repo', 'owner/repo')

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: 'Unauthorized' })
  })

  test('returns 400 when repo is missing', async () => {
    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('commit', 'abc123')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Missing repo name' })
  })

  test('returns success for a valid upload', async () => {
    mockTarX.mockResolvedValue(undefined)

    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'owner/repo')
      .field('commit', 'abc123')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'success',
      project: 'owner-repo',
      commit: 'abc123',
    })

    expect(mockTarX).toHaveBeenCalledTimes(1)
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('deployments/owner-repo'),
      { recursive: true },
    )
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1)

    const statusResponse = await request(app).get('/deploy/status/owner-repo')
    expect(statusResponse.status).toBe(200)
    expect(statusResponse.body).toMatchObject({
      project: 'owner-repo',
      status: 'live',
      repo: 'owner/repo',
      commit: 'abc123',
      url: '/sites/owner-repo/',
    })
  })

  test('flattens dist/projectName artifact layout into deployment root', async () => {
    mockTarX.mockResolvedValue(undefined)

    const distPathSuffix = `${path.join('deployments', 'owner-repo', 'dist')}`
    const distProjectPathSuffix = `${path.join('deployments', 'owner-repo', 'dist', 'owner-repo')}`

    jest.spyOn(fs, 'statSync').mockImplementation((targetPath) => ({
      isDirectory: () =>
        targetPath.endsWith(distProjectPathSuffix) || targetPath.endsWith(distPathSuffix),
    }))
    jest.spyOn(fs, 'readdirSync').mockImplementation(() => [{ name: 'index.html' }])
    jest.spyOn(fs, 'accessSync').mockImplementation(() => {
      throw new Error('missing')
    })
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation(() => undefined)
    const rmSpy = jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined)

    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'owner/repo')
      .field('commit', 'abc123')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(response.status).toBe(200)
    expect(renameSpy).toHaveBeenCalledWith(
      expect.stringContaining(path.join('deployments', 'owner-repo', 'dist', 'owner-repo', 'index.html')),
      expect.stringContaining(path.join('deployments', 'owner-repo', 'index.html')),
    )
    expect(rmSpy).toHaveBeenCalledWith(
      expect.stringContaining(path.join('deployments', 'owner-repo', 'dist')),
      { recursive: true, force: true },
    )
  })

  test('flattens dist-only artifact layout into deployment root', async () => {
    mockTarX.mockResolvedValue(undefined)

    const distPathSuffix = `${path.join('deployments', 'owner-repo', 'dist')}`
    const distProjectPathSuffix = `${path.join('deployments', 'owner-repo', 'dist', 'owner-repo')}`

    jest.spyOn(fs, 'statSync').mockImplementation((targetPath) => ({
      isDirectory: () => targetPath.endsWith(distPathSuffix) && !targetPath.endsWith(distProjectPathSuffix),
    }))
    jest.spyOn(fs, 'readdirSync').mockImplementation(() => [{ name: 'index.html' }])
    jest.spyOn(fs, 'accessSync').mockImplementation(() => {
      throw new Error('missing')
    })
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation(() => undefined)
    const rmSpy = jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined)

    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'owner/repo')
      .field('commit', 'abc123')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(response.status).toBe(200)
    expect(renameSpy).toHaveBeenCalledWith(
      expect.stringContaining(path.join('deployments', 'owner-repo', 'dist', 'index.html')),
      expect.stringContaining(path.join('deployments', 'owner-repo', 'index.html')),
    )
    expect(rmSpy).toHaveBeenCalledWith(
      expect.stringContaining(path.join('deployments', 'owner-repo', 'dist')),
      { recursive: true, force: true },
    )
  })

  test('returns 500 when extraction fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockTarX.mockRejectedValue(new Error('extract failed'))

    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'owner/repo')
      .field('commit', 'abc123')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: 'Deployment failed' })
  })

  test('returns 400 when artifact file is missing', async () => {
    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'owner/repo')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Missing artifact file' })
    expect(mockTarX).not.toHaveBeenCalled()
  })

  test('returns 400 for directory traversal attempt (..)', async () => {
    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'owner/../admin')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Invalid repo name')
    expect(mockTarX).not.toHaveBeenCalled()
  })

  test('returns 400 for absolute path attempt', async () => {
    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', '/etc/passwd')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Invalid repo name')
    expect(mockTarX).not.toHaveBeenCalled()
  })

  test('returns 400 for repo without slash', async () => {
    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'malformed-repo-name')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Invalid repo name format')
    expect(mockTarX).not.toHaveBeenCalled()
  })

  test('returns 400 for special characters in repo', async () => {
    const response = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'owner/repo@name')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Invalid repo name')
    expect(mockTarX).not.toHaveBeenCalled()
  })

  test('serves /assets files from project inferred by /sites referer', async () => {
    mockTarX.mockResolvedValue(undefined)

    const assetContent = 'body { color: red; }'
    const assetDir = path.join(process.cwd(), 'deployments', 'owner-repo', 'assets')
    const assetPath = path.join(assetDir, 'index.css')

    await fs.promises.mkdir(assetDir, { recursive: true })
    await fs.promises.writeFile(assetPath, assetContent)

    const response = await request(app)
      .get('/assets/index.css')
      .set('Referer', 'http://localhost:3000/sites/owner-repo/')

    expect(response.status).toBe(200)
    expect(response.text).toBe(assetContent)

    await fs.promises.rm(path.join(process.cwd(), 'deployments', 'owner-repo'), {
      recursive: true,
      force: true,
    })
  })

  test('relays root /assets request to github-pages site using /sites referer context', async () => {
    process.env.ENABLE_GITHUB_PAGES = 'true'
    mockTriggerBuild.mockResolvedValue(undefined)

    await request(app)
      .post('/deploy')
      .send({
        repo: 'owner/repo',
        branch: 'main',
        hostingTarget: 'github-pages',
      })

    mockFetch.mockResolvedValue(
      new Response('body { color: blue; }', {
        status: 200,
        headers: { 'content-type': 'text/css' },
      }),
    )

    const response = await request(app)
      .get('/assets/index.css')
      .set('Referer', 'http://localhost:3000/sites/owner-repo/')

    expect(response.status).toBe(200)
    expect(response.text).toContain('color: blue')
    expect(mockFetch).toHaveBeenCalledWith(
      new URL('https://owner.github.io/repo/assets/index.css'),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  test('does not serve /assets files without /sites referer context', async () => {
    mockTarX.mockResolvedValue(undefined)

    const response = await request(app).get('/assets/index.css')

    expect(response.status).toBe(404)
  })
})
