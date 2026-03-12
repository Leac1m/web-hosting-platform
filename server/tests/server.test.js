import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { jest } from '@jest/globals'

const mockTarX = jest.fn()
const mockTriggerBuild = jest.fn()

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

describe('POST /deploy/upload', () => {
  let app

  beforeEach(async () => {
    jest.resetModules()

    process.env.DEPLOY_SECRET = 'test-secret'
    process.env.GITHUB_TOKEN = 'gh-token'
    delete process.env.GITHUB_APP_ID

    mockTarX.mockReset()
    mockTriggerBuild.mockReset()

    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined)

    const serverModule = await import('../server.js')
    app = serverModule.default
  })

  afterEach(() => {
    jest.restoreAllMocks()
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
      })
      expect(mockTriggerBuild).toHaveBeenCalledWith(
        'owner/repo',
        'main',
        'gh-token',
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

  test('does not serve /assets files without /sites referer context', async () => {
    mockTarX.mockResolvedValue(undefined)

    const response = await request(app).get('/assets/index.css')

    expect(response.status).toBe(404)
  })
})
