# Repository Selection API — Implementation Plan

## Objective

Expose a `GET /api/github/repositories` endpoint that returns a user-scoped, paginated list of GitHub repositories accessible through the installed GitHub App, with lightweight data mapping and optional server-side search.

## Scope

In scope:

- Installation ID resolution at OAuth callback time and on-demand fallback.
- Short-lived Installation Access Token generation (reuses existing `githubAppAuth.js` infrastructure).
- `GET /api/github/repositories` endpoint with pagination and optional search filter.
- Simplified data transformation (strip unnecessary GitHub API fields).
- In-memory cache (5-minute TTL per user) to protect against rate-limit exhaustion on frequent UI refreshes.
- Webhook handler for `installation_repositories` (added/removed) to invalidate cache.
- Error surface for 401 (uninstalled), 404 (invalid installation), and 403 (rate-limited) scenarios.
- Unit and integration tests.

Out of scope (current phase):

- Persisting a repo metadata cache to `db.json`.
- Cross-installation repository federation (multiple orgs).
- Automatic repository provisioning or workflow setup from the list UI.

---

## Current Baseline

| Asset | Relevance |
|---|---|
| `server/services/githubAppAuth.js` | Provides `getInstallationToken(owner, repo)` and `getInstallationOctokit(owner, repo)` — currently repo-scoped. New helper needed for installation-scoped auth using only `installation_id`. |
| `server/controllers/authController.js` | Handles OAuth callback; stores `user` object in `sessions` Map. Session object needs `installationId` field added. |
| `server/routes/authRoutes.js` | Registers auth routes under `/auth`. No changes required structurally. |
| `server/routes/deployRoutes.js` | Reference pattern for route registration with `requireAuth` middleware. |
| `server/server.js` | Where new `githubRoutes` must be registered. |
| `server/env.js` | Validates `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY_*` — these are already sufficient. |

---

## Key Design Decision: Installation ID Resolution

The existing `getInstallationToken(owner, repo)` performs a per-repo installation lookup (`apps.getRepoInstallation`). For listing all installation repositories we need the `installation_id` directly.

**Strategy — resolve at OAuth callback, lazy fallback on first request:**

1. During `handleGitHubCallback`, after exchanging the OAuth code for a user token, call `GET /users/{username}/installation` using an App-JWT-authenticated Octokit. If the user has the App installed, store `installation.id` in the session object.
2. If that call returns 404 (App not installed by that user), store `installationId: null` in the session. The repository endpoint returns a `{ error: 'app_not_installed', installUrl: '...' }` response so the frontend can prompt the user to install.
3. Provide a `refreshInstallationId(req)` helper in `githubController.js` that re-runs the lookup on demand (used automatically if `installationId` is null at request time, to handle post-install scenarios without requiring re-login).

---

## Functional Requirements Mapping

1. **Token Exchange** — given `installation_id`, generate a short-lived Installation Access Token (`POST /app/installations/{id}/access_tokens`) using App Private Key (RS256). Token is scoped to that installation.
2. **Repository List** — call `GET /user/installations/{installation_id}/repositories` with the installation token; this endpoint is user-scoped so only repos the authenticated user has access to within the installation are returned.
3. **Pagination** — GitHub returns `Link` headers with `rel="next"` on multi-page responses. Parse them to produce `{ next_page, has_more }`.
4. **Search Filter** — GitHub's list-installation-repos endpoint does not support server-side search. Apply a `name.includes(search)` filter on the response payload before returning. Document this limitation.
5. **Cache** — in-memory `Map<userId, { repos, expiresAt }>` with 5-minute TTL; bypassed on `?bust=1` or when cache is stale.
6. **Cache Invalidation** — webhook `installation_repositories` handler calls `repoCache.delete(login)` for affected users when repos are added or removed.
7. **Error Mapping** — HTTP 401 from GitHub → `{ error: 'app_uninstalled' }` (410). HTTP 404 → `{ error: 'installation_not_found' }` (404). HTTP 403 with `X-RateLimit-Remaining: 0` → `{ error: 'rate_limited', resetAt }` (429).

---

## Technical Specifications

### New Environment Variables

None required. Existing `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_*`, and `GITHUB_APP_CLIENT_ID`/`GITHUB_APP_CLIENT_SECRET` are sufficient.

Optional flag to enable webhook verification:

```
GITHUB_WEBHOOK_SECRET=   # if set, validates X-Hub-Signature-256 on /webhooks/github
```

### New Files

| File | Purpose |
|---|---|
| `server/services/githubRepoService.js` | Core logic: token exchange, GitHub API call, pagination parsing, cache |
| `server/controllers/githubController.js` | HTTP handler: input validation, cache/fallback orchestration, response shaping |
| `server/routes/githubRoutes.js` | Route definitions: `GET /api/github/repositories` |
| `server/tests/githubRepoService.test.js` | Unit tests for service layer |
| `server/tests/githubController.test.js` | Integration tests for controller/route |

### Modified Files

| File | Change |
|---|---|
| `server/services/githubAppAuth.js` | Add `getInstallationTokenById(installationId)` and `getAppOctokit()` helpers |
| `server/controllers/authController.js` | Resolve and store `installationId` in session during OAuth callback |
| `server/server.js` | Register `githubRoutes` and optional webhook handler |

---

## Implementation Phases

### Phase 1 — `githubAppAuth.js` Additions

Add two new exports:

**`getAppOctokit()`** — returns an Octokit instance authenticated via App JWT (no installation). Used to call `apps.getUserInstallation`.

```js
// Approximate shape
export function getAppOctokit() {
  const { appId, privateKey } = getAppConfig()
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  })
}
```

**`getInstallationTokenById(installationId)`** — mints an installation token using only the numeric ID, without needing an `owner/repo` pair.

```js
export async function getInstallationTokenById(installationId) {
  const { appId, privateKey } = getAppConfig()
  const appOctokit = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey } })
  const { data } = await appOctokit.rest.apps.createInstallationAccessToken({
    installation_id: installationId,
  })
  return data.token
}
```

No changes to existing exports.

---

### Phase 2 — Session: Installation ID Storage

In `authController.js`, after resolving the authenticated user from the OAuth token exchange callback:

```js
// After user data is fetched, before createSession():
let installationId = null
try {
  const appOctokit = getAppOctokit()
  const { data: installation } = await appOctokit.rest.apps.getUserInstallation({
    username: user.login,
  })
  installationId = installation.id
} catch (err) {
  // 404 = App not installed by this user — acceptable, installationId stays null
  if (err.status !== 404) throw err
}

const sessionId = createSession({ ...user, installationId })
```

`getAppOctokit` is imported from `githubAppAuth.js`.

Session object shape after change:

```js
{
  user: {
    login: 'username',
    id: 12345,
    avatar_url: '...',
    name: '...',
    installationId: 98765  // null if App not installed
  },
  createdAt: 1700000000000
}
```

`req.user.installationId` is then available in all authenticated routes.

---

### Phase 3 — `githubRepoService.js`

Responsibilities: token generation, GitHub API call, pagination parsing, search filtering, cache management.

```
server/services/githubRepoService.js
```

**Cache structure:**

```js
// Map<userLogin, { repos: RepoItem[], fetchedAt: number }>
const repoCache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes
```

**`listRepositories(installationId, userLogin, { page, perPage, search })`**

Flow:
1. Check `repoCache.get(userLogin)` — if fresh (within TTL) and no `search`, return cached slice.
2. Call `getInstallationTokenById(installationId)` to obtain a short-lived token.
3. Call `GET /user/installations/{installationId}/repositories?per_page=100&page=1` using that token. Fetch all pages to populate the full cache (up to a maximum of 500 repos to guard against pathological installations). Store in cache.
4. Apply optional `search` filter as case-insensitive substring match on `name`.
5. Slice the result to requested `page`/`perPage` window and compute pagination metadata.
6. Return `{ repositories: RepoItem[], pagination: { next_page, has_more } }`.

**`normalizeRepo(raw)`** — maps GitHub's response object to the simplified frontend schema:

```js
function normalizeRepo(raw) {
  return {
    id: raw.id,
    name: raw.name,
    full_name: raw.full_name,
    is_private: raw.private,
    description: raw.description ?? null,
    html_url: raw.html_url,
    last_updated: raw.updated_at,
  }
}
```

**`invalidateCacheForUser(userLogin)`** — called by webhook handler:

```js
export function invalidateCacheForUser(userLogin) {
  repoCache.delete(userLogin)
}
```

**Error handling:**

| GitHub HTTP | Thrown as |
|---|---|
| 401 | `GitHubRepoError('app_uninstalled', 410)` |
| 404 | `GitHubRepoError('installation_not_found', 404)` |
| 403 + rate limit | `GitHubRepoError('rate_limited', 429, { resetAt })` |

`GitHubRepoError` is a subclass of `Error` with `code` and `statusCode` fields, parallel to `GitHubPagesError` in `githubPagesService.js`.

---

### Phase 4 — `githubController.js`

```
server/controllers/githubController.js
```

**`listRepositories(req, res)`**

```
GET /api/github/repositories
  ?page=1
  ?per_page=30
  ?search=my-app
```

1. Validate `page` and `per_page` — coerce to integers, clamp `per_page` to `[1, 100]`.
2. Check `req.user.installationId`. If null, attempt lazy resolution via `getAppOctokit().rest.apps.getUserInstallation({ username: req.user.login })`, update session in place. If still 404, return `404 { error: 'app_not_installed', installUrl: 'https://github.com/apps/<app-slug>/installations/new' }`.
3. Delegate to `githubRepoService.listRepositories(...)`.
4. On `GitHubRepoError`, return the mapped HTTP status and error code.
5. Return `200 { repositories, pagination }`.

---

### Phase 5 — `githubRoutes.js`

```
server/routes/githubRoutes.js
```

```js
import express from 'express'
import { requireAuth } from '../controllers/authController.js'
import { listRepositories } from '../controllers/githubController.js'

const router = express.Router()

// GET /api/github/repositories
router.get('/repositories', requireAuth, listRepositories)

export default router
```

Register in `server.js`:

```js
import githubRoutes from './routes/githubRoutes.js'
// ...
app.use('/api/github', githubRoutes)
```

---

### Phase 6 — Webhook Handler

**Event**: `installation_repositories` with action `added` or `removed`.

Register a raw-body endpoint in `server.js` (must be before `express.json()` global middleware for this route only):

```js
// server.js — before app.use(express.json())
app.post(
  '/webhooks/github',
  express.raw({ type: 'application/json' }),
  handleGitHubWebhook,
)
```

**`handleGitHubWebhook(req, res)`** in `githubController.js`:

1. If `GITHUB_WEBHOOK_SECRET` is set, verify `X-Hub-Signature-256` using `crypto.timingSafeEqual`. Reject with 401 on mismatch.
2. Parse body as JSON, read `x-github-event` header.
3. On `installation_repositories` with action `added` or `removed`: extract `sender.login`, call `invalidateCacheForUser(login)`, return `204`.
4. All other events: return `204` immediately (no-op).

Signature verification snippet:

```js
import crypto from 'crypto'

function verifyWebhookSignature(rawBody, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
```

---

### Phase 7 — Tests

#### `server/tests/githubRepoService.test.js`

| # | Description |
|---|---|
| 1 | Returns normalized repos from GitHub API, respects `per_page` slice |
| 2 | Serves subsequent requests from cache within TTL |
| 3 | Re-fetches after cache invalidation via `invalidateCacheForUser` |
| 4 | Applies case-insensitive `search` filter |
| 5 | Throws `GitHubRepoError('rate_limited', 429)` on 403 with rate-limit headers |
| 6 | Throws `GitHubRepoError('app_uninstalled', 410)` on 401 |
| 7 | Throws `GitHubRepoError('installation_not_found', 404)` on 404 |

All tests mock `getInstallationTokenById` and the downstream `fetch` / Octokit request.

#### `server/tests/githubController.test.js`

| # | Description |
|---|---|
| 1 | `GET /api/github/repositories` returns 200 with `repositories` array and `pagination` object |
| 2 | Returns 429 with `error: 'rate_limited'` and `resetAt` on rate-limit error |
| 3 | Returns 404 with `error: 'app_not_installed'` when `installationId` is null and lazy lookup returns 404 |
| 4 | Clamps `per_page` to 100 when caller sends `per_page=999` |
| 5 | Webhook `POST /webhooks/github` returns 204 and calls `invalidateCacheForUser` on `installation_repositories` event |
| 6 | Webhook returns 401 when `GITHUB_WEBHOOK_SECRET` is set and signature is missing |

---

### Phase 8 — Frontend Wiring

#### `frontend/src/services/api.js`

Add to the `deployApi` object (or adjacent `githubApi` export):

```js
export const githubApi = {
  listRepositories: (params) =>
    api.get('/api/github/repositories', { params }),
}
```

`params` shape: `{ page, per_page, search }` — passed as query string by axios.

#### `frontend/src/App.jsx` or a new `RepositorySelector` component

- Render a searchable dropdown / modal that calls `githubApi.listRepositories`.
- Debounce the `search` input (300 ms) to avoid flooding the backend.
- Handle `app_not_installed` error by showing an "Install GitHub App" link.
- Handle `rate_limited` error by showing a retry-after countdown using the `resetAt` field.
- On selection, pass `full_name` as the deployment target to `triggerDeployment`.

---

## Response Schema

### Success — `200 OK`

```json
{
  "repositories": [
    {
      "id": 12345678,
      "name": "my-awesome-repo",
      "full_name": "org-name/my-awesome-repo",
      "is_private": true,
      "description": "Project description here",
      "html_url": "https://github.com/org-name/my-awesome-repo",
      "last_updated": "2023-10-27T10:00:00Z"
    }
  ],
  "pagination": {
    "next_page": 2,
    "has_more": true
  }
}
```

### Error — `404 App Not Installed`

```json
{
  "error": "app_not_installed",
  "installUrl": "https://github.com/apps/<app-slug>/installations/new"
}
```

### Error — `429 Rate Limited`

```json
{
  "error": "rate_limited",
  "resetAt": "2024-01-15T12:05:00Z"
}
```

### Error — `410 App Uninstalled` (token rejection)

```json
{
  "error": "app_uninstalled"
}
```

---

## Security Constraints

- All routes protected by `requireAuth` — no anonymous access.
- Installation token is short-lived (max 1 hour, typically ~10 minutes) and never forwarded to the frontend.
- Webhook signature verification prevents spoofed cache-invalidation requests when `GITHUB_WEBHOOK_SECRET` is configured.
- `per_page` is hard-clamped server-side to prevent unbounded GitHub API calls.
- No user-supplied strings are interpolated into GitHub API URL path segments — `installationId` is taken from the trusted session, not from query parameters.
- Raw webhook body is read before JSON parsing to allow HMAC verification over the original bytes.

---

## Rollout Sequence

1. Phase 1 — Extend `githubAppAuth.js` (non-breaking additions only).
2. Phase 2 — Update `authController.js` to capture `installationId` (backward compatible; null when App not installed).
3. Phase 3 — Implement `githubRepoService.js` with unit tests.
4. Phase 4 — Implement `githubController.js`.
5. Phase 5 — Implement `githubRoutes.js` and register in `server.js`.
6. Phase 6 — Add webhook handler.
7. Phase 7 — Write integration tests.
8. Phase 8 — Wire frontend.

---

## Testing Plan

- Unit tests mock `getInstallationTokenById` and the underlying Octokit/fetch request.
- Integration tests for the controller use `jest.unstable_mockModule` on `githubRepoService.js` (consistent with existing test pattern in `server.test.js`).
- Webhook tests use raw `Buffer` bodies to validate signature verification logic end-to-end.
- Cache tests manipulate `Date.now` via `jest.spyOn(Date, 'now')` to simulate TTL expiry without sleeping.

---

## Success Criteria

- `GET /api/github/repositories?page=1&per_page=30` returns a correctly shaped list for an authenticated user with the App installed.
- A subsequent identical request within 5 minutes is served from cache (no GitHub API call).
- After a `installation_repositories` webhook event, the cache for the affected user is cleared and the next request re-fetches.
- `per_page=999` is silently clamped to 100.
- A user whose `installationId` is null receives a 404 with `installUrl` in the body.
- All new unit and integration tests pass alongside the existing 85-test suite.
