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

## Setup Instructions

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
   GITHUB_TOKEN=<your-github-token> \
   DEPLOY_SECRET=<your-deploy-secret> \
   NODE_ENV=development \
   npm start
   ```

2. Call the `/deploy` endpoint:
   ```bash
   curl -X POST http://localhost:3000/deploy \
     -H "Content-Type: application/json" \
     -d '{"repo": "owner/repo", "branch": "main"}'
   ```

## Directory Structure After Deployment

```
deployments/
  owner-repo/           # Example: owner-repo
    index.html
    css/
    js/
    ...
```

Access at: `http://localhost:3000/sites/owner-repo/`
