# Programmatic GitHub Pages Management - Implementation Plan

## Objective

Enable the backend to configure and manage GitHub Pages for a repository using the GitHub App, without manual setup in repository settings.

## Scope

In scope:

- Programmatic GitHub Pages activation.
- Programmatic source enforcement to GitHub Actions workflow mode.
- Retrieval of Pages status and URL metadata.
- Handling private-repo and legacy configuration constraints.

Out of scope (current phase):

- Custom domain provisioning automation (`cname` updates).
- DNS ownership verification workflows.
- Multi-environment Pages orchestration.

## Current Baseline

- GitHub App installation token flow exists in `server/services/githubAppAuth.js`.
- Deployment target switching exists in `server/services/buildService.js` and `server/controllers/deployController.js`.
- GitHub Pages status fields (`hostingUrl`, `providerUrl`) and relay behavior already exist.
- Deployment status persistence exists in `server/services/deployStatusStore.js` via `server/db.json`.

## Functional Requirements Mapping

1. Enable Pages Hosting:

- Implement API call `POST /repos/{owner}/{repo}/pages` with payload `{"build_type":"workflow"}`.

2. Set Build Source:

- Ensure source is workflow mode.
- If repository is in legacy branch mode, enforce update to workflow mode.

3. Status Retrieval:

- Query and return Pages runtime/config metadata (URL, HTTPS state, DNS state where available).

4. Error Handling:

- Surface plan limitations and configuration conflicts with actionable messages.
- Handle HTTP 422 for private repo restrictions and unsupported states.

## Technical Specifications

GitHub API:

- `GET /repos/{owner}/{repo}/pages` (pre-check/status)
- `POST /repos/{owner}/{repo}/pages` (activation)
- `PUT /repos/{owner}/{repo}/pages` (update mode / future cname)

Headers:

- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2022-11-28`

Authentication:

- GitHub App Installation Access Token (IAT)

Required app permissions:

- Administration: write
- Pages: write
- Actions: write (already needed for workflow dispatch)

## Implementation Design

### 1) Add GitHub Pages Service

Create `server/services/githubPagesService.js`.

Functions:

- `getPagesConfig(owner, repo)`
- `enablePagesWorkflow(owner, repo)`
- `updatePagesToWorkflow(owner, repo)`
- `ensurePagesWorkflow(owner, repo)`

Behavior:

- `ensurePagesWorkflow` performs:
  1. Pre-check via `GET /pages`
  2. If not enabled: `POST /pages` with `build_type: workflow`
  3. If enabled but not workflow: `PUT /pages` to workflow mode
  4. Return normalized config payload

### 2) Extend GitHub App Auth Utility

Update `server/services/githubAppAuth.js` with helper:

- `getInstallationOctokit(owner, repo)`

Use this helper from `githubPagesService.js` and existing workflow dispatch/secret operations to avoid duplicated token wiring.

### 3) Integrate Into Deployment Flow

Update `server/controllers/deployController.js`:

- In `triggerDeployment`, when `hostingTarget === 'github-pages'`:
  1. Call `ensurePagesWorkflow(owner, repo)` before dispatch.
  2. Persist setup results into status store:
     - `pagesConfigured`
     - `pagesSource`
     - `providerUrl` (from config fallback to computed)
     - `pagesLastCheckedAt`
  3. Continue dispatch via `triggerBuild`.

### 4) Add Pages Config Endpoints

Update `server/routes/deployRoutes.js` and `server/controllers/deployController.js`:

- `GET /deploy/pages-config/:project`
  - Returns stored + live Pages config where possible.
- `POST /deploy/pages-config/:project/sync`
  - Forces reconciliation to workflow mode.

Keep existing:

- `GET /deploy/pages-status/:project`
- `GET /deploy/pages-health/:project`

### 5) Error Model

Add normalized error mapping in `githubPagesService.js`:

- `401` -> auth failure
- `403` -> insufficient permissions
- `404` -> repo/install not found
- `409` -> conflict (retry/sync guidance)
- `422` -> private plan restriction or invalid Pages state

Return user-safe messages while logging detailed diagnostics.

### 6) Observability

Structured logs for:

- `pages_precheck`
- `pages_enabled`
- `pages_updated_to_workflow`
- `pages_sync_failed`

Include:

- `repo`, `owner`, `project`, `hostingTarget`, `httpStatus`, `providerUrl`.

### 7) Persistence Impact

No schema migration needed (JSON document store).

Persist additional optional fields in `server/db.json` per project:

- `pagesConfigured`
- `pagesSource`
- `pagesLastCheckedAt`
- `pagesConfigStatus`

## Edge Cases and Constraints

1. Private repositories:

- Handle `422` with explicit guidance about required GitHub plan.

2. Legacy branch-based Pages config:

- Reconfigure to workflow mode using update endpoint.

3. Existing custom domain:

- Do not overwrite `cname` in this phase.
- Preserve and return current domain metadata if present.

4. Missing installation permissions:

- Return permission-specific error and stop dispatch for pages target.

## Rollout Plan

1. Add feature flag:

- `ENABLE_GITHUB_PAGES_AUTO_CONFIG=true`

2. Stage rollout:

- Stage 1: dry-run mode (`GET /pages` only, logs and warnings)
- Stage 2: enable POST/PUT for selected repositories
- Stage 3: full rollout

3. Backward compatibility:

- `hostingTarget` default remains `platform`
- Existing clients unaffected

## Testing Plan

### Unit tests

Add `server/tests/githubPagesService.test.js`:

- activate from disabled state
- no-op when already workflow mode
- migrate from branch mode to workflow
- map 422/403/404 errors correctly

### Integration tests

Update `server/tests/server.test.js`:

- `POST /deploy` with `github-pages` triggers ensure-step before dispatch
- Pages sync endpoint behavior (`/deploy/pages-config/:project/sync`)
- Pages config endpoint shape and failure paths

### Regression tests

- Ensure platform deploy path remains unchanged.
- Ensure relay behavior remains transparent (no response mutation).

## Success Criteria

1. Repository Pages source shows GitHub Actions without manual settings changes.
2. Deploy request for `github-pages` self-configures Pages when needed.
3. Backend returns actionable status and error details for Pages setup.
4. Private repository limitations are handled with clear user-facing messages.
5. Existing platform deployment path remains fully functional.

## Suggested Work Breakdown

1. Create `githubPagesService.js` and tests.
2. Add shared Octokit helper in `githubAppAuth.js`.
3. Integrate ensure-step in `triggerDeployment`.
4. Add config/sync endpoints.
5. Update docs and env examples.
6. Run full test suite and verify with a live repository.
