import request from 'supertest'
import fs from 'fs'
import { jest } from '@jest/globals'

const mockTarX = jest.fn()
const mockTriggerBuild = jest.fn()

jest.unstable_mockModule('tar', () => ({
  x: mockTarX,
}))

jest.unstable_mockModule('../services/buildService.js', () => ({
  triggerBuild: mockTriggerBuild,
}))

describe('POST /deploy/upload', () => {
  let app

  beforeEach(async () => {
    jest.resetModules()

    process.env.DEPLOY_SECRET = 'test-secret'
    process.env.GITHUB_TOKEN = 'gh-token'

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
    test('returns 400 when repo is missing', async () => {
      const response = await request(app)
        .post('/deploy')
        .send({ branch: 'main' })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Missing repo name' })
      expect(mockTriggerBuild).not.toHaveBeenCalled()
    })

    test('returns 500 when GitHub token is missing', async () => {
      delete process.env.GITHUB_TOKEN

      const response = await request(app)
        .post('/deploy')
        .send({ repo: 'owner/repo', branch: 'main' })

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ error: 'Missing GitHub token' })
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
})
