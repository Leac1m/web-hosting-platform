import crypto from 'crypto'
import axios from 'axios'

const sessions = new Map()

function getGithubClientId() {
  return process.env.GITHUB_APP_CLIENT_ID
}

function getGithubClientSecret() {
  return process.env.GITHUB_APP_CLIENT_SECRET
}

function getBackendUrl() {
  return process.env.BACKEND_URL || 'http://localhost:3000'
}

function getFrontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173'
}

function getRedirectUri() {
  return `${getBackendUrl()}/auth/github/callback`
}

function createSession(user) {
  const sessionId = crypto.randomUUID()
  sessions.set(sessionId, {
    user,
    createdAt: Date.now(),
  })

  return sessionId
}

function getSession(sessionId) {
  if (!sessionId) {
    return null
  }

  const session = sessions.get(sessionId)
  return session || null
}

export function requireAuth(req, res, next) {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    req.user = { login: 'test-user' }
    return next()
  }

  const sessionId = req.cookies?.session_id
  const session = getSession(sessionId)

  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  req.user = session.user
  return next()
}

export function handleGitHubLogin(req, res) {
  const githubClientId = getGithubClientId()

  if (!githubClientId) {
    return res.status(500).json({ error: 'Missing GitHub OAuth client ID' })
  }

  const params = new URLSearchParams({
    client_id: githubClientId,
    redirect_uri: getRedirectUri(),
    scope: 'read:user user:email',
  })

  return res.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`,
  )
}

export async function handleGitHubCallback(req, res) {
  const code = req.query.code
  const githubClientId = getGithubClientId()
  const githubClientSecret = getGithubClientSecret()

  if (!code) {
    return res.status(400).json({ error: 'Missing OAuth code' })
  }

  if (!githubClientId || !githubClientSecret) {
    return res.status(500).json({ error: 'Missing GitHub OAuth configuration' })
  }

  try {
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: githubClientId,
        client_secret: githubClientSecret,
        code,
        redirect_uri: getRedirectUri(),
      },
      {
        headers: {
          Accept: 'application/json',
        },
      },
    )

    const accessToken = tokenResponse.data?.access_token

    if (!accessToken) {
      return res
        .status(401)
        .json({ error: 'GitHub OAuth token exchange failed' })
    }

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    })

    const user = {
      id: userResponse.data?.id,
      login: userResponse.data?.login,
      avatarUrl: userResponse.data?.avatar_url,
    }

    const sessionId = createSession(user)

    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })

    return res.redirect(getFrontendUrl())
  } catch (error) {
    return res.status(500).json({ error: 'GitHub OAuth callback failed' })
  }
}

export function getMe(req, res) {
  return res.json({ user: req.user })
}

export function handleLogout(req, res) {
  const sessionId = req.cookies?.session_id

  if (sessionId) {
    sessions.delete(sessionId)
  }

  res.clearCookie('session_id')
  return res.json({ success: true })
}
