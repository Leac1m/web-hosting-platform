# GitHub Pages Hosting Feature - Implementation Plans

## Goal

Add a new deployment target that publishes repositories to GitHub Pages while keeping the existing artifact-upload hosting flow intact.

This backend already uses GitHub Apps for:

- workflow dispatch
- repository secret management

The new feature should reuse that GitHub App integration and expose a clear "hosting target" choice per deployment request.

## Current Baseline (What Already Exists)

- `POST /deploy` triggers `deploy.yml` in the target repository.
- `POST /deploy/upload` receives build artifacts and serves them from `deployments/<project>/`.
- GitHub App auth is implemented in `services/githubAppAuth.js` and used by deployment logic.
- Repository secrets are updated from backend before dispatch.

## Product Scope

### In Scope

- Add `hostingTarget` selector (`platform` vs `github-pages`) to deployment request.
- Add GitHub Pages deployment workflow support.
- Track and return Pages deployment metadata (URL, status, last commit).
- Preserve existing local hosting behavior.

### Out of Scope (Phase 1)

- Custom domain automation (`CNAME`, DNS verification).
- Preview deployments per PR.
- Multi-environment routing (staging/prod pages) in one repository.

---

## Plan A (Recommended MVP): Workflow-based GitHub Pages

Use repository workflow dispatch (already supported) and add a second workflow dedicated to Pages deployment.

### Why Plan A

- Minimal backend changes.
- Reuses existing app permissions and secret update flow.
- Works with current operational model.

### Backend Changes

1. Request contract update

- Endpoint: `POST /deploy`
- Add body field:
  - `hostingTarget`: `platform` (default) or `github-pages`
- Validation:
  - reject unknown values with HTTP 400

2. Controller updates

- File: `controllers/deployController.js`
- Behavior:
  - parse `hostingTarget`
  - store in deploy status entries
  - pass target to build trigger function

3. Build trigger service update

- File: `services/buildService.js`
- Add workflow selection:
  - `platform` -> `deploy.yml` (current behavior)
  - `github-pages` -> `deploy-pages.yml`
- Add target-aware error messages for easier troubleshooting.

4. GitHub App auth service update

- File: `services/githubAppAuth.js`
- Extend `triggerWorkflowWithApp(owner, repo, branch, workflowId = 'deploy.yml')`
- Keep default for backward compatibility.

5. Deployment status model

- File: `services/deployStatusStore.js`
- Extend stored payload with:
  - `hostingTarget`
  - `hostingUrl` (for Pages URL)
  - `providerStatus` (`queued`, `building`, `live`, `failed`)

6. New status endpoint for Pages state (optional in MVP, recommended)

- Endpoint: `GET /deploy/pages-status/:project`
- Returns latest GitHub Pages URL and workflow outcome.

### GitHub Workflow Changes

Add repository workflow template for Pages deployment (`workflows/deploy-pages.yml`):

- checkout branch
- install/build
- upload static artifact
- deploy with `actions/deploy-pages`

Required permissions in workflow:

- `pages: write`
- `id-token: write`
- `contents: read`

### GitHub App Permissions

Current app permissions likely need one addition:

- `Pages: Read and write` (repository permission)

Keep existing:

- `Actions: Read and write`
- `Contents: Read-only`

### API Contract Example

```json
{
  "repo": "owner/repo",
  "branch": "main",
  "hostingTarget": "github-pages"
}
```

Response example:

```json
{
  "status": "queued",
  "repo": "owner/repo",
  "branch": "main",
  "hostingTarget": "github-pages"
}
```

### Test Plan (Plan A)

1. Unit tests

- validate `hostingTarget` parsing and defaults
- workflow selection logic
- GitHub App trigger with custom workflow id

2. Integration tests

- `POST /deploy` for both targets
- failure case for unsupported target

3. Smoke test

- dispatch `github-pages` deployment and verify returned URL pattern:
  - `https://<owner>.github.io/<repo>/` (project pages)
  - or `https://<owner>.github.io/` (user/organization pages repo)

### Rollout Steps (Plan A)

1. Add backend support behind feature flag: `ENABLE_GITHUB_PAGES=true`
2. Release with default `platform` target
3. Enable for internal repos first
4. Expand to all users after 1 week of stable metrics

### Effort Estimate (Plan A)

- Backend coding: 1-2 days
- Tests and stabilization: 1 day
- Docs and rollout: 0.5 day
- Total: ~3 to 3.5 days

---

## Plan B (Advanced): API-driven Pages Provisioning + Workflow Dispatch

Plan B adds automatic repository Pages configuration through GitHub API before workflow dispatch.

### Extra Capabilities

- Auto-enable Pages if disabled
- Auto-select source branch/folder or Actions mode
- Better first-time setup experience

### Extra Backend Changes

1. New service: `services/githubPagesService.js`

- `getPagesConfig(owner, repo)`
- `ensurePagesEnabled(owner, repo)`
- `getPagesUrl(owner, repo)`

2. Controller integration

- During `POST /deploy` with `hostingTarget=github-pages`:
  - call `ensurePagesEnabled`
  - then dispatch workflow

3. New API endpoints

- `GET /deploy/pages-config/:project`
- `POST /deploy/pages-config/:project/sync`

### Additional Risks

- Pages API behavior differences by repository type.
- Permissions mismatch between app installation and repository settings.
- Longer deploy request latency if provisioning is in-band.

### Effort Estimate (Plan B)

- Backend coding: 2-3 days
- Tests and resilience handling: 1-2 days
- Total: ~4 to 5 days

---

## Data Model Additions

For status records (in-memory now, persistent later):

```json
{
  "project": "owner-repo",
  "repo": "owner/repo",
  "branch": "main",
  "hostingTarget": "github-pages",
  "providerStatus": "live",
  "hostingUrl": "https://owner.github.io/repo/",
  "commit": "abc123",
  "updatedAt": "2026-03-12T00:00:00.000Z"
}
```

## Backward Compatibility

- If `hostingTarget` is missing, default to `platform`.
- Existing clients continue to work unchanged.
- Existing `deploy.yml` path remains the default code path.

## Operational Observability

Add structured log fields:

- `hostingTarget`
- `workflowId`
- `pagesUrl`
- `githubRunId`

Track metrics:

- deployment success rate by target
- median time to live by target
- GitHub API error rate by endpoint and status code

## Security Checklist

- Validate repo ownership from authenticated user before dispatch.
- Never expose installation tokens in responses/logs.
- Keep `DEPLOY_SECRET` flow unchanged for platform target.
- Restrict Pages feature by allowlist during initial rollout.

## Recommendation

Implement Plan A first, then graduate selected pieces of Plan B once baseline Pages deployments are stable.

This yields fast delivery while preserving clean upgrade paths for auto-provisioning and richer status APIs.
