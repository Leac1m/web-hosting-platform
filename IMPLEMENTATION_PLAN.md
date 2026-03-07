# Implementation Plan: GitHub Apps + React Frontend

## Phase 1: GitHub Apps Authentication Migration

### Overview

Replace Personal Access Token authentication with GitHub Apps for better security, granular permissions, and scalability.

### Benefits

- ✅ **Installation-based auth** - Users install app on specific repos
- ✅ **Fine-grained permissions** - Only request `actions:write` permission
- ✅ **Automatic token refresh** - Short-lived JWT tokens (1 hour)
- ✅ **Better rate limits** - 5,000 req/hour per installation
- ✅ **Audit trail** - GitHub tracks app activity separately
- ✅ **No personal tokens** - Not tied to individual user accounts

---

## Phase 1 Tasks

### Step 1: Create GitHub App

**Duration:** 15-30 minutes

1. Go to GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
2. Configure app settings:

   ```yaml
   Name: Web Hosting Platform Deployer
   Homepage URL: http://localhost:3000 (or your domain)
   Callback URL: http://localhost:3000/auth/github/callback
   Webhook URL: (leave blank for now)
   Webhook Active: No
   ```

3. Set permissions:

   ```yaml
   Repository permissions:
     - Actions: Read & Write
     - Contents: Read-only
     - Metadata: Read-only (auto-included)
   ```

4. Where can this app be installed?
   - Select "Any account" or "Only on this account"

5. After creation, note down:
   - **App ID**
   - Generate and download **Private Key** (.pem file)
   - Note the **Client ID** and generate **Client Secret**

### Step 2: Update Environment Variables

**Duration:** 5 minutes

Update `.env` file:

```bash
# Remove old GitHub token approach
# GITHUB_TOKEN=ghp_xxxxx

# GitHub App Configuration
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=./github-app-private-key.pem
# OR base64 encoded key for production:
# GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi...

# For OAuth flow (Phase 2 - React frontend)
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxx

# Existing
DEPLOY_SECRET=super-secret-token-123
NODE_ENV=development
```

### Step 3: Install Dependencies

**Duration:** 2 minutes

```bash
cd server
pnpm add @octokit/auth-app @octokit/rest jsonwebtoken
```

**Why these packages:**

- `@octokit/auth-app` - Handles GitHub App JWT and installation token generation
- `@octokit/rest` - GitHub API client with better typing
- `jsonwebtoken` - For creating JWT tokens (if using custom implementation)

### Step 4: Create GitHub App Service

**Duration:** 30-45 minutes

Create `server/services/githubAppAuth.js`:

```javascript
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import fs from 'fs'

/**
 * Initialize GitHub App authentication
 * Reads private key from file or environment variable
 */
export function initializeGitHubApp() {
  const appId = process.env.GITHUB_APP_ID
  let privateKey

  // Try to load from file first
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH
  if (keyPath && fs.existsSync(keyPath)) {
    privateKey = fs.readFileSync(keyPath, 'utf8')
  } else if (process.env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    // For production: base64 encoded key in env var
    privateKey = Buffer.from(
      process.env.GITHUB_APP_PRIVATE_KEY_BASE64,
      'base64',
    ).toString('utf8')
  } else {
    throw new Error('GitHub App private key not found')
  }

  if (!appId) {
    throw new Error('GITHUB_APP_ID not set')
  }

  return {
    appId,
    privateKey,
  }
}

/**
 * Get installation access token for a specific repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<string>} Installation access token
 */
export async function getInstallationToken(owner, repo) {
  const { appId, privateKey } = initializeGitHubApp()

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  })

  // Get the installation ID for this repository
  const { data: installation } = await octokit.rest.apps.getRepoInstallation({
    owner,
    repo,
  })

  // Create an installation access token
  const {
    data: { token },
  } = await octokit.rest.apps.createInstallationAccessToken({
    installation_id: installation.id,
  })

  return token
}

/**
 * Trigger GitHub Actions workflow using GitHub App authentication
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch to deploy
 * @returns {Promise<void>}
 */
export async function triggerWorkflowWithApp(owner, repo, branch) {
  const token = await getInstallationToken(owner, repo)

  const octokit = new Octokit({
    auth: token,
  })

  await octokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: 'deploy.yml',
    ref: branch,
  })
}
```

### Step 5: Update buildService.js

**Duration:** 20 minutes

Refactor `server/services/buildService.js` to support both auth methods:

```javascript
import axios from 'axios'
import {
  triggerWorkflowWithApp,
  getInstallationToken,
} from './githubAppAuth.js'

export class GitHubError extends Error {
  constructor(message, statusCode, githubError) {
    super(message)
    this.statusCode = statusCode
    this.githubError = githubError
  }
}

/**
 * Determine auth method based on environment
 */
function getAuthMethod() {
  if (process.env.GITHUB_APP_ID) {
    return 'app'
  } else if (process.env.GITHUB_TOKEN) {
    return 'token'
  }
  throw new Error('No GitHub authentication configured')
}

/**
 * Trigger build using GitHub App (preferred) or token (legacy)
 */
export async function triggerBuild(repo, branch, token = null) {
  const [owner, repoName] = repo.split('/')
  const authMethod = getAuthMethod()

  try {
    if (authMethod === 'app') {
      // New GitHub App method
      await triggerWorkflowWithApp(owner, repoName, branch)
    } else {
      // Legacy token method
      await triggerWithToken(owner, repoName, branch, token)
    }
  } catch (err) {
    // Handle errors and convert to GitHubError
    throw mapGitHubError(err)
  }
}

async function triggerWithToken(owner, repo, branch, token) {
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/deploy.yml/dispatches`,
    { ref: branch },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    },
  )
}

function mapGitHubError(err) {
  const status = err.response?.status || err.status

  if (status === 401) {
    return new GitHubError(
      'GitHub authentication failed',
      401,
      'authentication_failed',
    )
  }
  if (status === 403) {
    return new GitHubError(
      'No permission to access repo or workflow',
      403,
      'permission_denied',
    )
  }
  if (status === 404) {
    return new GitHubError(
      'Repository, workflow, or GitHub App not installed',
      404,
      'not_found',
    )
  }
  if (status === 422) {
    return new GitHubError(
      'Invalid branch or repository reference',
      422,
      'invalid_ref',
    )
  }

  return err
}
```

### Step 6: Update Controller

**Duration:** 10 minutes

Update `server/controllers/deployController.js`:

```javascript
// Remove githubToken parameter usage
export const triggerDeployment = async (req, res) => {
  const repo = req.body?.repo
  const branch = req.body?.branch || 'main'

  if (!repo) {
    return res.status(400).json({ error: 'Missing repo name' })
  }

  const projectName = getProjectNameFromRepo(repo)
  logEvent('deploy_requested', { repo, branch, project: projectName })

  try {
    // No longer need to pass token - service handles auth
    await triggerBuild(repo, branch)

    setDeployStatus(projectName, 'queued', { repo, branch })
    logEvent('deploy_queued', { repo, branch, project: projectName })

    return res.status(202).json({
      status: 'queued',
      repo,
      branch,
    })
  } catch (err) {
    logError('deploy_trigger_failed', err, {
      repo,
      branch,
      project: projectName,
    })
    setDeployStatus(projectName, 'failed', {
      repo,
      branch,
      reason: err?.message || 'Unknown error',
    })

    if (err instanceof GitHubError) {
      return res.status(err.statusCode).json({ error: err.message })
    }

    return res.status(500).json({
      error: 'Failed to trigger deployment',
    })
  }
}
```

### Step 7: Install GitHub App on Test Repository

**Duration:** 5 minutes

1. Go to your GitHub App settings
2. Click "Install App" tab
3. Select account and choose repositories
4. Install on a test repository with `deploy.yml` workflow

### Step 8: Test GitHub App Integration

**Duration:** 15 minutes

```bash
# Start server
pnpm run dev

# Test deployment trigger
curl -X POST http://localhost:3000/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "youruser/test-repo",
    "branch": "main"
  }'

# Verify in GitHub Actions tab that workflow was triggered
```

### Step 9: Update Tests

**Duration:** 30 minutes

Update test files to mock GitHub App instead of token:

- Mock `@octokit/auth-app` and `@octokit/rest`
- Update environment setup in tests
- Verify all tests pass

### Step 10: Update Documentation

**Duration:** 15 minutes

Update `DEPLOYMENT.md` with GitHub App setup instructions.

---

## Phase 2: Minimal React Frontend

### Overview

Build a simple React frontend for:

- Triggering deployments
- Viewing deployment status
- OAuth login with GitHub
- Managing allowed repositories

### Features

```
┌─────────────────────────────────────┐
│  Web Hosting Platform Dashboard    │
├─────────────────────────────────────┤
│ [Login with GitHub]                 │
│                                      │
│ Logged in as: @username             │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ Deploy New Site                  │ │
│ │                                  │ │
│ │ Repository: [owner/repo ▼]      │ │
│ │ Branch:     [main ▼]            │ │
│ │ [Deploy]                        │ │
│ └─────────────────────────────────┘ │
│                                      │
│ My Deployments                       │
│ ┌──────────────────────────────────┐│
│ │ owner-repo       ● Live          ││
│ │ main • abc1234 • 2m ago          ││
│ │ [View] [Redeploy] [Logs]         ││
│ └──────────────────────────────────┘│
│ ┌──────────────────────────────────┐│
│ │ another-repo     ⏱ Building      ││
│ │ dev • def5678 • 30s ago          ││
│ └──────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

## Phase 2 Tasks

### Step 1: Create React App

**Duration:** 10 minutes

```bash
cd /home/leac1m/projects/web-hosting-platform
npx create-react-app frontend
cd frontend
pnpm add axios react-router-dom
```

### Step 2: Add GitHub OAuth Routes to Backend

**Duration:** 45 minutes

Create `server/routes/authRoutes.js`:

```javascript
import express from 'express'
import {
  handleGitHubLogin,
  handleGitHubCallback,
  handleLogout,
  requireAuth,
} from '../controllers/authController.js'

const router = express.Router()

router.get('/github', handleGitHubLogin)
router.get('/github/callback', handleGitHubCallback)
router.post('/logout', requireAuth, handleLogout)
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user)
})

export default router
```

Create `server/controllers/authController.js`:

```javascript
import axios from 'axios'
import { Octokit } from '@octokit/rest'

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET
const REDIRECT_URI =
  process.env.GITHUB_CALLBACK_URL ||
  'http://localhost:3000/auth/github/callback'

// In-memory session store (use Redis in production)
const sessions = new Map()

export const handleGitHubLogin = (req, res) => {
  const scope = 'read:user,user:email'
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${scope}`
  res.redirect(githubAuthUrl)
}

export const handleGitHubCallback = async (req, res) => {
  const { code } = req.query

  try {
    // Exchange code for access token
    const { data } = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      },
      {
        headers: { Accept: 'application/json' },
      },
    )

    const accessToken = data.access_token

    // Get user info
    const octokit = new Octokit({ auth: accessToken })
    const { data: user } = await octokit.rest.users.getAuthenticated()

    // Create session
    const sessionId = crypto.randomUUID()
    sessions.set(sessionId, {
      userId: user.id,
      username: user.login,
      avatarUrl: user.avatar_url,
      accessToken, // Store user's OAuth token (not for deployments)
    })

    // Set cookie and redirect to frontend
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    })

    res.redirect('http://localhost:3001/dashboard')
  } catch (error) {
    console.error('OAuth error:', error)
    res.redirect('http://localhost:3001?error=auth_failed')
  }
}

export const handleLogout = (req, res) => {
  const sessionId = req.cookies.session_id
  sessions.delete(sessionId)
  res.clearCookie('session_id')
  res.json({ success: true })
}

export const requireAuth = (req, res, next) => {
  const sessionId = req.cookies.session_id
  const session = sessions.get(sessionId)

  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  req.user = session
  next()
}

export const getSession = (sessionId) => {
  return sessions.get(sessionId)
}
```

### Step 3: Add Session Support to Server

**Duration:** 15 minutes

Update `server/server.js`:

```javascript
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import deployRoutes from './routes/deployRoutes.js'
import authRoutes from './routes/authRoutes.js'

const app = express()

// Middleware
app.use(
  cors({
    origin: 'http://localhost:3001',
    credentials: true,
  }),
)
app.use(express.json())
app.use(cookieParser())

// Routes
app.use('/sites', express.static('deployments'))
app.use('/deploy', deployRoutes)
app.use('/auth', authRoutes)

export default app
```

Install dependencies:

```bash
pnpm add cookie-parser cors
```

### Step 4: Protect Deployment Endpoints

**Duration:** 20 minutes

Update `server/controllers/deployController.js`:

```javascript
import { requireAuth } from './authController.js'

// Add authentication to deployment routes
// In routes/deployRoutes.js:
router.post('/', requireAuth, triggerDeployment)
router.get('/status/:project', requireAuth, getDeploymentStatus)
```

### Step 5: Create React Components

**Duration:** 2-3 hours

Create components:

```
frontend/src/
  components/
    Login.jsx          - Login screen
    Dashboard.jsx      - Main dashboard
    DeploymentForm.jsx - Form to trigger deployment
    DeploymentList.jsx - List of deployments
    DeploymentCard.jsx - Individual deployment status
  services/
    api.js            - API client
  App.jsx             - Main app with routing
  index.js            - Entry point
```

### Step 6: Build API Client

**Duration:** 30 minutes

`frontend/src/services/api.js`:

```javascript
import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:3000',
  withCredentials: true,
})

export const auth = {
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
}

export const deploy = {
  trigger: (repo, branch) => api.post('/deploy', { repo, branch }),
  status: (project) => api.get(`/deploy/status/${project}`),
  list: () => api.get('/deploy/list'), // New endpoint needed
}

export default api
```

### Step 7: Implement React Components

**Duration:** 3-4 hours

Build out the UI components with:

- Login with GitHub button
- Deployment form with validation
- Real-time status updates (polling or WebSockets)
- Error handling and loading states
- Responsive design with Tailwind or basic CSS

### Step 8: Add Deployment List Endpoint

**Duration:** 30 minutes

Create `server/controllers/deployController.js` addition:

```javascript
export const listDeployments = (req, res) => {
  const { username } = req.user

  // Get all deployments for this user
  // Filter by repositories the user has access to
  const deployments = getAllDeployments().filter((d) =>
    userHasAccess(username, d.repo),
  )

  res.json(deployments)
}
```

### Step 9: Testing & Polish

**Duration:** 1-2 hours

- Test full OAuth flow
- Test deployment triggering from UI
- Test status updates and polling
- Add loading spinners and error messages
- Test responsive design

---

## Phase 3: Advanced Features (Future)

### Potential enhancements:

1. **WebSocket for real-time updates** - Push status changes to frontend
2. **Deployment history** - Store deployment logs in database
3. **Rollback functionality** - Revert to previous deployments
4. **Custom domains** - Allow users to map custom domains
5. **Environment variables** - UI to manage deployment env vars
6. **Build logs** - Stream GitHub Actions logs to frontend
7. **Team management** - Share deployments with team members
8. **Deployment previews** - Per-PR deployments
9. **Usage analytics** - Track deployment metrics
10. **Database persistence** - Replace in-memory stores with PostgreSQL

---

## Timeline Estimate

| Phase       | Task                  | Duration        |
| ----------- | --------------------- | --------------- |
| **Phase 1** | GitHub Apps Migration | 3-4 hours       |
| **Phase 2** | React Frontend        | 8-10 hours      |
| **Total**   |                       | **11-14 hours** |

---

## Next Steps

1. Review this plan
2. Decide on Phase 1 start date
3. Create GitHub App
4. Begin implementation following steps above

**Commands to start:**

```bash
# Phase 1: Install dependencies
cd server
pnpm add @octokit/auth-app @octokit/rest

# Phase 2: Create React app
cd ..
npx create-react-app frontend
cd frontend
pnpm add axios react-router-dom
```
