# Web Hosting Platform - Deployment Setup

## GitHub Secrets Required

Configure the following secrets in your GitHub repository for automated deployments:

### `DEPLOY_BACKEND_URL`

- **Description:** The base URL of your deployment backend server
- **Example:** `https://api.example.com` or `http://localhost:3000` (for local testing)
- **Required:** Yes

### `DEPLOY_SECRET`

- **Description:** Bearer token for authenticating artifact uploads to the backend
- **Security:** Keep this value secure; treat it like a password
- **Where it's used:** GitHub Actions workflow uploads artifacts to `/deploy/upload` endpoint
- **Required:** Yes

## Deployment Flow

1. **User triggers deploy** → calls `POST /deploy` with `repo` and optional `branch`
2. **Backend dispatches GitHub Action** → GitHub receives workflow_dispatch event
3. **Workflow runs on GitHub** → checks out code, builds React app, creates tar archive
4. **Workflow uploads artifact** → sends build.tar.gz to `POST /deploy/upload` endpoint
5. **Backend extracts and serves** → artifact is extracted to `deployments/<owner-repo>/`
6. **Site goes live** → accessible at `/sites/<owner-repo>`

### Default Target: GitHub Pages

The deployment trigger endpoint defaults to publishing to GitHub Pages.

1. **User triggers deploy** → calls `POST /deploy` with `hostingTarget: github-pages`
2. **Backend dispatches Pages workflow** → triggers `deploy-pages.yml` on the target repository
3. **GitHub Pages publishes site** → provider URL is `https://<owner>.github.io/<repo>/`
4. **Backend relays the site** → served from `/sites/<owner-repo>/`

### URL Semantics for GitHub Pages Deployments

- `hostingUrl`: Backend URL for consumers and UI (for example `/sites/owner-repo/`)
- `providerUrl`: Upstream GitHub Pages URL (for example `https://owner.github.io/repo/`)

The backend relay keeps requests under the project path and mitigates absolute-root asset and fetch requests by resolving them through the selected project context.

## Setup Instructions

### 0. Configure GitHub App (Required)

Create and install a GitHub App with repository permissions:

- **Actions:** Read and write
- **Contents:** Read and write
- **Workflows:** Read and write

Set backend environment variables:

```bash
GITHUB_APP_ID=<app-id>
GITHUB_APP_PRIVATE_KEY_PATH=<path-to-private-key.pem>
# or
GITHUB_APP_PRIVATE_KEY_BASE64=<base64-pem>

# Optional feature flag for GitHub Pages deployment target
ENABLE_GITHUB_PAGES=true

# Optional feature flag for workflow file injection API
ENABLE_WORKFLOW_INJECTION=true

# Phase 2 frontend auth URLs
BACKEND_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173
```

### 1. Set Backend URL Secret

```bash
gh secret set DEPLOY_BACKEND_URL --body "https://your-backend-domain.com"
```

### 2. Set Deploy Secret

Generate a secure random token (e.g., using `openssl rand -base64 32`), then:

```bash
gh secret set DEPLOY_SECRET --body "<your-token>"
```

### 3. Set Server Environment Variable

On your backend server, set the same `DEPLOY_SECRET`:

```bash
export DEPLOY_SECRET="<your-token>"
```

### 4. Trigger a Manual Deployment

```bash
gh workflow run deploy.yml --ref main
```

## Local Testing

### Neon Postgres + Drizzle (recommended)

Configure environment values in `.env`:

```bash
DATABASE_URL=postgresql://<user>:<password>@<project>-pooler.<region>.aws.neon.tech/<db>?sslmode=require
DIRECT_DATABASE_URL=postgresql://<user>:<password>@<project>.<region>.aws.neon.tech/<db>?sslmode=require
```

Generate a migration from the Drizzle schema:

```bash
pnpm db:generate
```

Apply migrations to Neon:

```bash
pnpm db:migrate
```

Open Drizzle Studio (optional):

```bash
pnpm db:studio
```

Neon guidance used for this setup:
- Prefer pooled URL for app runtime.
- Prefer direct URL for schema migration and admin tasks.

To test locally without pushing to GitHub:

1. Start the server with `.env` file:
   ```bash
   GITHUB_APP_ID=<app-id> \
   GITHUB_APP_PRIVATE_KEY_PATH=<path-to-private-key.pem> \
   DEPLOY_SECRET=<your-deploy-secret> \
   NODE_ENV=development \
   npm run dev
   ```

Legacy fallback is still supported:

```bash
GITHUB_TOKEN=<your-github-token>
```

2. Call the `/deploy` endpoint:

   ```bash
   curl -X POST http://localhost:3000/deploy \
     -H "Content-Type: application/json" \
     -d '{"repo": "owner/repo", "branch": "main"}'
   ```

3. Call the `/deploy` endpoint for GitHub Pages:

```bash
curl -X POST http://localhost:3000/deploy \
  -H "Content-Type: application/json" \
  -d '{"repo": "owner/repo", "branch": "main", "hostingTarget": "github-pages"}'
```

Sample response:

```json
{
  "status": "queued",
  "repo": "owner/repo",
  "branch": "main",
  "hostingTarget": "github-pages",
  "hostingUrl": "/sites/owner-repo/",
  "providerUrl": "https://owner.github.io/repo/",
  "workflowSyncStatus": "no_changes",
  "pagesSource": "workflow",
  "pagesAction": "enabled"
}
```

4. Check Pages-specific status:

```bash
curl http://localhost:3000/deploy/pages-status/owner-repo
```

5. Check Pages upstream availability:

```bash
curl http://localhost:3000/deploy/pages-health/owner-repo
```

Sample healthy response:

```json
{
  "project": "owner-repo",
  "repo": "owner/repo",
  "hostingTarget": "github-pages",
  "hostingUrl": "/sites/owner-repo/",
  "providerUrl": "https://owner.github.io/repo/",
  "available": true,
  "upstreamStatus": 200,
  "checkedAt": "2026-03-13T00:00:00.000Z"
}
```

6. Retrieve current GitHub Pages config details:

```bash
curl http://localhost:3000/deploy/pages-config/owner-repo
```

Sample response:

```json
{
  "project": "owner-repo",
  "repo": "owner/repo",
  "hostingTarget": "github-pages",
  "hostingUrl": "/sites/owner-repo/",
  "providerUrl": "https://owner.github.io/repo/",
  "pagesConfigured": true,
  "pagesSource": "workflow",
  "httpsCertificateState": "approved",
  "status": "built",
  "protectedDomainState": "verified",
  "checkedAt": "2026-03-13T00:00:00.000Z"
}
```

7. Force Pages configuration sync to workflow mode:

```bash
curl -X POST http://localhost:3000/deploy/pages-config/owner-repo/sync
```

Sample response:

```json
{
  "project": "owner-repo",
  "repo": "owner/repo",
  "hostingTarget": "github-pages",
  "hostingUrl": "/sites/owner-repo/",
  "providerUrl": "https://owner.github.io/repo/",
  "pagesConfigured": true,
  "pagesSource": "workflow",
  "action": "updated",
  "syncedAt": "2026-03-13T00:00:00.000Z"
}
```

8. Create/update managed workflow files via commit sync:

```bash
curl -X POST http://localhost:3000/deploy/workflows/sync \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "owner/repo",
    "baseBranch": "main",
    "mode": "commit",
    "files": ["deploy.yml", "deploy-pages.yml"],
    "force": false
  }'
```

Sample sync response:

```json
{
  "status": "synced",
  "repo": "owner/repo",
  "mode": "commit",
  "branch": "main",
  "changedFiles": [
    ".github/workflows/deploy.yml",
    ".github/workflows/deploy-pages.yml"
  ],
  "skippedFiles": []
}
```

Sample unavailable response (HTTP 503):

```json
{
  "project": "owner-repo",
  "repo": "owner/repo",
  "hostingTarget": "github-pages",
  "hostingUrl": "/sites/owner-repo/",
  "providerUrl": "https://owner.github.io/repo/",
  "available": false,
  "upstreamStatus": null,
  "reason": "Failed to reach provider",
  "checkedAt": "2026-03-13T00:00:00.000Z"
}
```

## Workflow Templates

Repository workflow templates are available in:

- `workflows/deploy.yml` for platform artifact upload flow
- `workflows/deploy-pages.yml` for GitHub Pages publishing flow

## Single Deployment (Frontend + Server)

This repository can be deployed as a single service where Express serves both the backend APIs and the built frontend.

### Runtime Behavior

- Frontend app is served from `/` using `frontend/dist`
- API routes remain under `/auth`, `/deploy`, and `/api/github`
- Webhook route remains under `/webhooks/github`
- Project hosting routes remain under `/sites/:project`

### Production Environment Values

Use same-origin values in production:

```bash
NODE_ENV=production
BACKEND_URL=https://your-domain.com
FRONTEND_URL=https://your-domain.com
DEPLOY_BACKEND_URL=https://your-domain.com
```

### Build and Start Commands

Build command:

```bash
cd server && pnpm install --frozen-lockfile && pnpm run build:frontend
```

Start command:

```bash
cd server && pnpm run start
```

If your host only supports a single command:

```bash
cd server && pnpm install --frozen-lockfile && pnpm run start:prod
```

### Local Verification for Single Deployment

```bash
cd server
pnpm run build:frontend
pnpm run start
```

Then open `http://localhost:3000/` and verify:

- frontend loads from Express
- API calls work via same origin
- `/sites/:project` routes still function

### Required CI Check Before Deploy

Enable branch protection for `main` and require the GitHub Actions workflow
`Predeploy Checks` (job: `verify`) to pass before merge.

This workflow is defined in:

- `.github/workflows/predeploy-checks.yml`

It enforces the minimum predeploy gates:

- `pnpm run build:frontend` (from `server/`)
- `pnpm test` (server test suite)

## Directory Structure After Deployment

```
deployments/
  owner-repo/           # Simple approach (default)
    index.html
    css/
    js/
    ...
```

OR with versioning enabled for zero-downtime swaps:

```
deployments/
  owner-repo/
    current -> symlink to releases/v1-abc123/
    releases/
      v1-abc123/        # Versioned release
        index.html
        css/
        js/
      v2-def456/        # Previous release (kept for rollback)
      v3-ghi789/        # Newest release
```

### Simple Serving (Default)

Access at: `http://localhost:3000/sites/owner-repo/`

Files in `deployments/owner-repo/` are served directly. Each deployment overwrites previous files.

### Versioned Serving (Optional - Zero-Downtime)

Access at: `http://localhost:3000/sites/owner-repo/`

- Each deployment creates a timestamped release: `v<timestamp>-<commit-short>/`
- Symlink `current` atomically points to the latest version
- In-flight requests continue reading old version until symlink updates
- Rollback: simply update symlink to previous release
- Cleanup: automatically keep N most recent versions (default: 5)

To enable versioning in your code:

```javascript
import {
  createVersionedDeploymentPath,
  updateCurrentSymlink,
} from './services/deploymentManager.js'

// In /deploy/upload endpoint:
const { versionedPath, currentLink } = createVersionedDeploymentPath(
  projectName,
  commit,
)

// Extract to versionedPath instead of projectName
await tar.x({
  file: req.file.path,
  cwd: versionedPath,
})

// Atomically update symlink
updateCurrentSymlink(currentLink, versionedPath)

// Optionally cleanup old releases
import { cleanupOldReleases } from './services/deploymentManager.js'
cleanupOldReleases(projectName, 5) // Keep 5 most recent
```
