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

### Alternative Target: GitHub Pages

The deployment trigger endpoint also supports publishing to GitHub Pages.

1. **User triggers deploy** → calls `POST /deploy` with `hostingTarget: github-pages`
2. **Backend dispatches Pages workflow** → triggers `deploy-pages.yml` on the target repository
3. **GitHub Pages publishes site** → served from `https://<owner>.github.io/<repo>/`

## Setup Instructions

### 0. Configure GitHub App (Required)
Create and install a GitHub App with repository permissions:
- **Actions:** Read and write
- **Contents:** Read-only

Set backend environment variables:
```bash
GITHUB_APP_ID=<app-id>
GITHUB_APP_PRIVATE_KEY_PATH=<path-to-private-key.pem>
# or
GITHUB_APP_PRIVATE_KEY_BASE64=<base64-pem>

# Optional feature flag for GitHub Pages deployment target
ENABLE_GITHUB_PAGES=true

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

4. Check Pages-specific status:
  ```bash
  curl http://localhost:3000/deploy/pages-status/owner-repo
  ```

## Workflow Templates

Repository workflow templates are available in:

- `workflows/deploy.yml` for platform artifact upload flow
- `workflows/deploy-pages.yml` for GitHub Pages publishing flow

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
import { createVersionedDeploymentPath, updateCurrentSymlink } from './services/deploymentManager.js'

// In /deploy/upload endpoint:
const { versionedPath, currentLink } = createVersionedDeploymentPath(
  projectName,
  commit
)

// Extract to versionedPath instead of projectName
await tar.x({
  file: req.file.path,
  cwd: versionedPath
})

// Atomically update symlink
updateCurrentSymlink(currentLink, versionedPath)

// Optionally cleanup old releases
import { cleanupOldReleases } from './services/deploymentManager.js'
cleanupOldReleases(projectName, 5) // Keep 5 most recent
```
