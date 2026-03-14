# Single Deployment Implementation Plan

## Goal

Deploy the frontend and server together as one application under a single public origin.

Target runtime model:

- Express serves the built Vite frontend from `/`
- Express continues serving API endpoints from `/auth`, `/deploy`, `/api/github`, and `/webhooks/github`
- Existing hosted project routes under `/sites/:project` continue to work unchanged
- Browser requests use same-origin API calls in production

This removes the need to deploy frontend and backend separately and simplifies CORS, auth cookies, and operational setup.

---

## Current State

### Frontend

- Vite app in `frontend/`
- Build output is `frontend/dist`
- Asset base is already relative in `frontend/vite.config.js`, which is good for both `/` and nested hosted-site use cases
- API client in `frontend/src/services/api.js` defaults to `http://localhost:3000`

### Backend

- Express app in `server/`
- Currently serves API routes and `/sites/:project` content only
- Does not currently serve `frontend/dist`
- Uses cookie auth, so same-origin deployment will simplify session handling

### Operational implication

Today the app behaves like two deployments:

- frontend dev server at `localhost:5173`
- backend API at `localhost:3000`

For production, a single deployment should make Express the only public service.

---

## Desired End State

A production deployment should behave like this:

- `GET /` returns the built frontend app
- `GET /assets/...` serves frontend static assets from the Vite build
- `GET /auth/*`, `POST /deploy/*`, `GET /api/github/*`, and `POST /webhooks/github` continue to route to backend handlers
- `GET /sites/:project/*` continues to serve or relay deployed user sites
- Frontend API requests default to same-origin in production

---

## Scope

### In scope

- Serve the frontend build from Express
- Add build/start scripts to support one deployment artifact
- Make frontend API client production-safe for same-origin deployment
- Document local dev, staging, and production startup flow
- Add deployment validation checklist

### Out of scope

- Replacing Express with SSR or Next.js
- Dockerizing the app unless separately requested
- Multi-service orchestration with CDN offload
- Reworking existing `/sites/:project` hosted-site architecture

---

## Implementation Plan

## Phase 1 - Production routing integration

### Objective

Make the server serve the built frontend bundle without breaking existing API and hosted-site behavior.

### Changes

1. Add frontend dist path resolution in `server/server.js`
2. Mount static file serving for `frontend/dist`
3. Add SPA fallback for non-API, non-`/sites`, non-webhook routes
4. Keep API and project-hosting routes registered before the SPA fallback

### Routing rules

The server should preserve this precedence order:

1. `/webhooks/github`
2. `/sites/:project`
3. root asset fallback logic for deployed project sites
4. `/auth`
5. `/deploy`
6. `/api/github`
7. frontend static assets from `frontend/dist`
8. SPA fallback to `frontend/dist/index.html`

### Acceptance criteria

- Visiting `/` loads the frontend app from Express
- Refreshing a frontend route returns `index.html` rather than a 404
- API endpoints still return JSON
- `/sites/:project/...` behavior is unchanged

---

## Phase 2 - Frontend same-origin API behavior

### Objective

Remove the requirement for a separate frontend API base URL in production.

### Changes

Update `frontend/src/services/api.js` so that:

- development defaults to `http://localhost:3000`
- production defaults to same-origin using an empty base URL
- explicit override via `VITE_API_BASE_URL` remains supported

### Recommended logic

```js
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? '' : 'http://localhost:3000')
```

### Acceptance criteria

- Local dev continues to work with separate Vite and Express processes
- Production frontend calls `/auth`, `/deploy`, and `/api/github` on the same host
- OAuth login redirect generation still works correctly

---

## Phase 3 - Unified build and start scripts

### Objective

Make the repo deployable as a single service with one build/start flow.

### Changes

In `server/package.json`, add scripts like:

- `build:frontend`: install frontend deps and run Vite build
- `start`: run the Express server normally
- `start:prod`: build frontend then start server

Recommended script shape:

```json
{
  "scripts": {
    "dev": "node --watch index.js",
    "test": "NODE_OPTIONS=--experimental-vm-modules jest",
    "build:frontend": "pnpm --dir ../frontend install --frozen-lockfile && pnpm --dir ../frontend build",
    "start": "node index.js",
    "start:prod": "pnpm run build:frontend && pnpm run start"
  }
}
```

Optional improvement:

- add a root workspace `package.json` later if you want one-command repo-wide installs/builds

### Acceptance criteria

- One command can build the frontend and start the backend
- Deployment platform only needs to run the server package

---

## Phase 4 - Environment model cleanup

### Objective

Align environment variables with a same-origin deployment model.

### Changes

1. Keep `BACKEND_URL` for OAuth callback generation and absolute backend references
2. Make `FRONTEND_URL` optional for same-origin production if frontend is served by Express
3. Document recommended production values:

```bash
NODE_ENV=production
BACKEND_URL=https://your-domain.com
FRONTEND_URL=https://your-domain.com
DEPLOY_BACKEND_URL=https://your-domain.com
```

4. Document local development values separately:

```bash
NODE_ENV=development
BACKEND_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173
DEPLOY_BACKEND_URL=http://localhost:3000
```

### Risk note

`FRONTEND_URL` is currently also used by CORS. In same-origin production, CORS becomes much less important, but the setting should remain valid for local development.

### Acceptance criteria

- OAuth callback returns users to the correct public origin
- Cookie auth works consistently in production
- Existing local dev flow remains unchanged

---

## Phase 5 - Verification and rollout

### Objective

Validate that the unified deployment works end-to-end.

### Test checklist

1. Build frontend:

- confirm `frontend/dist/index.html` exists

2. Start server in production mode:

- confirm `/` serves HTML
- confirm frontend assets load successfully

3. Verify backend endpoints:

- `GET /auth/me`
- `GET /deploy/list`
- `GET /api/github/repositories`

4. Verify frontend app behavior:

- login flow redirects back to app
- deployment list loads
- deploy action succeeds
- pages config sync still works

5. Verify hosted-site routing is not broken:

- `GET /sites/:project/`
- project assets under `/sites/:project/assets/...`
- root fallback asset behavior for Pages relay remains intact

### Rollout strategy

1. Implement server-side static hosting and same-origin API base
2. Validate locally with `frontend` build + `server` runtime
3. Deploy to staging as one service
4. Confirm OAuth redirect and cookie behavior under HTTPS
5. Promote to production

---

## File-Level Change Map

### Backend

`server/server.js`

- Add frontend dist resolution
- Add `express.static(frontendDistPath)`
- Add SPA fallback route after API routes

`server/package.json`

- Add unified production build/start scripts

### Frontend

`frontend/src/services/api.js`

- Make production API base default to same-origin

### Documentation

`DEPLOYMENT.md`

- Add section for single-deployment setup
- Add production startup command
- Update environment variable guidance

Optional:

`example.env`

- Clarify same-origin production values

---

## Risks and Edge Cases

### 1. SPA fallback swallowing API routes

Mitigation:

- Place SPA fallback after all backend routes
- Explicitly exclude `/auth`, `/deploy`, `/api`, `/sites`, and `/webhooks`

### 2. Frontend asset path collisions with project-site relay fallback

Mitigation:

- Preserve current root fallback behavior and ensure frontend static assets are only served after API routing
- Test both frontend `/assets/*` and deployed project `/sites/:project/assets/*`

### 3. OAuth redirect mismatch

Mitigation:

- Keep `BACKEND_URL` and `FRONTEND_URL` documented clearly
- Validate actual production callback URL in GitHub App settings

### 4. Slow startup due to frontend build at runtime

Mitigation:

- Prefer building during deployment pipeline rather than on every container boot when the hosting platform supports build and start phases separately

---

## Recommended Deployment Model

For a platform like Railway, Render, Fly.io, or a VPS:

- Deploy only the `server/` app as the runtime service
- During build phase, run frontend install/build from the server package scripts
- During start phase, run `node index.js`
- Expose one public domain pointing to Express

Preferred commands:

Build command:

```bash
cd server && pnpm install --frozen-lockfile && pnpm run build:frontend
```

Start command:

```bash
cd server && pnpm run start
```

If the host only supports one command:

```bash
cd server && pnpm install --frozen-lockfile && pnpm run start:prod
```

---

## Success Criteria

This work is complete when:

1. The frontend and backend are reachable through one public domain
2. No separate frontend hosting is required in production
3. Frontend API requests work without cross-origin configuration in production
4. Existing `/sites/:project` deployment features continue to function
5. Deployment docs are clear enough for a clean production rollout

---

## Suggested Execution Order

1. Update `frontend/src/services/api.js`
2. Update `server/server.js`
3. Update `server/package.json`
4. Update `DEPLOYMENT.md`
5. Validate locally with a production build
6. Deploy to staging
7. Promote to production
