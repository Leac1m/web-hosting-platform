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
  GitHubError: class GitHubError extends Error {
    constructor(message, statusCode, githubError) {
      super(message)
      this.statusCode = statusCode
      this.githubError = githubError
    }
  },
}))

describe('Deploy lifecycle smoke test', () => {
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
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const serverModule = await import('../server.js')
    app = serverModule.default
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('queues deploy, receives artifact, and marks project live', async () => {
    mockTriggerBuild.mockResolvedValue(undefined)
    mockTarX.mockResolvedValue(undefined)

    const triggerResponse = await request(app)
      .post('/deploy')
      .send({ repo: 'owner/repo', branch: 'main' })

    expect(triggerResponse.status).toBe(202)
    expect(triggerResponse.body).toEqual({
      status: 'queued',
      repo: 'owner/repo',
      branch: 'main',
      hostingTarget: 'platform',
    })

    const queuedStatusResponse = await request(app).get('/deploy/status/owner-repo')
    expect(queuedStatusResponse.status).toBe(200)
    expect(queuedStatusResponse.body).toMatchObject({
      project: 'owner-repo',
      status: 'queued',
      repo: 'owner/repo',
      branch: 'main',
    })

    const uploadResponse = await request(app)
      .post('/deploy/upload')
      .set('Authorization', 'Bearer test-secret')
      .field('repo', 'owner/repo')
      .field('commit', 'abc123')
      .attach('artifact', Buffer.from('fake tar'), 'artifact.tar')

    expect(uploadResponse.status).toBe(200)
    expect(uploadResponse.body).toEqual({
      status: 'success',
      project: 'owner-repo',
      commit: 'abc123',
    })

    const liveStatusResponse = await request(app).get('/deploy/status/owner-repo')
    expect(liveStatusResponse.status).toBe(200)
    expect(liveStatusResponse.body).toMatchObject({
      project: 'owner-repo',
      status: 'live',
      repo: 'owner/repo',
      commit: 'abc123',
      url: '/sites/owner-repo/',
    })

    expect(mockTriggerBuild).toHaveBeenCalledWith(
      'owner/repo',
      'main',
      'gh-token',
      { hostingTarget: 'platform' }
    )
    expect(mockTarX).toHaveBeenCalledTimes(1)
  })
})
