import crypto from 'crypto'
import {
  GitHubRepoError,
  invalidateCacheForUser,
  listRepositories as listInstallationRepositories,
} from '../services/githubRepoService.js'
import { getAppOctokit } from '../services/githubAppAuth.js'
import { updateSessionUser } from './authController.js'

const INSTALL_URL_FALLBACK = 'https://github.com/apps/installations/new'

const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

const getInstallUrl = () => {
  const appSlug = process.env.GITHUB_APP_SLUG

  if (appSlug) {
    return `https://github.com/apps/${appSlug}/installations/new`
  }

  return INSTALL_URL_FALLBACK
}

const getSessionIdFromRequest = (req) => {
  if (req.sessionId) {
    return req.sessionId
  }

  return req.cookies?.session_id || null
}

export const refreshInstallationId = async (req) => {
  const username = req.user?.login

  if (!username) {
    return null
  }

  try {
    const appOctokit = getAppOctokit()
    const { data: installation } = await appOctokit.rest.apps.getUserInstallation(
      {
        username,
      },
    )

    const installationId = installation?.id || null

    if (installationId) {
      const sessionId = getSessionIdFromRequest(req)

      if (sessionId) {
        updateSessionUser(sessionId, { installationId })
      }

      req.user = {
        ...req.user,
        installationId,
      }
    }

    return installationId
  } catch (error) {
    const status = error?.status || error?.response?.status

    if (status === 404) {
      return null
    }

    throw error
  }
}

export const listRepositories = async (req, res) => {
  const page = toPositiveInteger(req.query.page, 1)
  const perPage = Math.min(toPositiveInteger(req.query.per_page, 30), 100)
  const search = typeof req.query.search === 'string' ? req.query.search : ''
  const bust = String(req.query.bust || '') === '1'

  try {
    let installationId = req.user?.installationId || null

    if (!installationId) {
      installationId = await refreshInstallationId(req)
    }

    if (!installationId) {
      return res.status(404).json({
        error: 'app_not_installed',
        installUrl: getInstallUrl(),
      })
    }

    const payload = await listInstallationRepositories(
      installationId,
      req.user?.login,
      {
        page,
        perPage,
        search,
        bust,
      },
    )

    return res.status(200).json(payload)
  } catch (error) {
    if (error instanceof GitHubRepoError) {
      const body = { error: error.code }

      if (error.code === 'rate_limited' && error.resetAt) {
        body.resetAt = error.resetAt
      }

      return res.status(error.statusCode || 500).json(body)
    }

    return res.status(500).json({ error: 'Failed to list repositories' })
  }
}

const verifyWebhookSignature = (rawBody, signature, secret) => {
  if (!signature || !rawBody) {
    return false
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`

  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(signature)

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
}

export const handleGitHubWebhook = (req, res) => {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET

  if (webhookSecret) {
    const signature = req.get('x-hub-signature-256')
    const isValid = verifyWebhookSignature(req.body, signature, webhookSecret)

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' })
    }
  }

  const eventName = req.get('x-github-event')

  let payload

  try {
    payload = JSON.parse(req.body.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'Invalid webhook payload' })
  }

  if (
    eventName === 'installation_repositories' &&
    (payload?.action === 'added' || payload?.action === 'removed')
  ) {
    const senderLogin = payload?.sender?.login

    if (senderLogin) {
      invalidateCacheForUser(senderLogin)
    }
  }

  return res.status(204).send()
}
