# Server-Driven Workflow Injection - Implementation Plan

## Goal

Enable the backend to inject and maintain managed GitHub Actions workflow files in user repositories using the existing GitHub App integration.

This feature should let the platform bootstrap required workflows automatically, reduce onboarding friction, and preserve safe repository ownership boundaries.

## Problem Statement

Today deployments assume workflows already exist in user repositories.

Pain points:

- deployment fails when `deploy.yml` or `deploy-pages.yml` is missing
- user setup is manual and error-prone
- workflow drift across repositories is hard to manage

## Objectives

- Create and update required workflow files in target repositories
- Use installation tokens from the existing GitHub App auth flow
- Support idempotent sync (skip unchanged files)
- Prefer safe PR-based updates by default
- Integrate with deployment flow as an optional bootstrap step

## Non-Goals (MVP)

- arbitrary file writes outside `.github/workflows/`
- full template rendering engine with user-defined placeholders
- auto-merge of pull requests
- modifying unrelated existing workflows not managed by this platform

---

## Recommended Delivery Strategy

### Phase 1 (MVP): PR-first Workflow Sync Endpoint

Add an endpoint that opens a pull request containing managed workflow files.

Why first:

- safest rollout model
- clear approval path for repo owners
- easiest operational auditability

### Phase 2: Optional Direct Commit Mode

Allow direct commit mode for trusted repositories after Phase 1 stabilizes.

### Phase 3: Deploy-Time Auto-Bootstrap

On deploy trigger, detect missing workflow and optionally run one-time sync + retry dispatch.

---

## GitHub App Requirements

Update app permissions:

- `Actions`: Read and write
- `Contents`: Read and write
- `Workflows`: Read and write
- `Pull requests`: Read and write (required for PR mode)

Keep existing installation model and token generation in `services/githubAppAuth.js`.

## Feature Flag

Add:

- `ENABLE_WORKFLOW_INJECTION=true`

Behavior:

- if false, sync endpoint returns 403
- if true, endpoint is active

---

## API Design

### Endpoint

`POST /deploy/workflows/sync`

### Request Body

```json
{
  "repo": "owner/repo",
  "baseBranch": "main",
  "mode": "pr",
  "files": ["deploy.yml", "deploy-pages.yml"],
  "force": false
}
```

Notes:

- `repo` required
- `baseBranch` defaults to `main`
- `mode` defaults to `pr` (`pr` or `commit`)
- `files` defaults to both managed workflows
- `force` defaults to `false`

### Response (PR mode)

```json
{
  "status": "synced",
  "repo": "owner/repo",
  "mode": "pr",
  "branch": "platform/workflows-sync-20260312-123456",
  "changedFiles": [
    ".github/workflows/deploy.yml",
    ".github/workflows/deploy-pages.yml"
  ],
  "skippedFiles": [],
  "pullRequestUrl": "https://github.com/owner/repo/pull/123"
}
```

### Response (No changes)

```json
{
  "status": "no_changes",
  "repo": "owner/repo",
  "mode": "pr",
  "changedFiles": [],
  "skippedFiles": [
    ".github/workflows/deploy.yml",
    ".github/workflows/deploy-pages.yml"
  ]
}
```

---

## File Management Model

Managed target paths:

- `.github/workflows/deploy.yml`
- `.github/workflows/deploy-pages.yml`

Template source paths (backend local):

- `../workflows/deploy.yml`
- `../workflows/deploy-pages.yml`

Add managed markers in template headers:

- `# Managed by Web Hosting Platform`
- `# Template-Version: 1`

Idempotency logic:

1. load local template
2. fetch remote file content (if present)
3. normalize line endings
4. compare content hash
5. skip if unchanged and `force=false`

Overwrite policy:

- only overwrite files with managed marker unless `force=true`

---

## Backend Architecture Changes

### 1. New Service: `services/workflowInjectionService.js`

Primary responsibilities:

- read local workflow templates
- create branch for sync (PR mode)
- get existing workflow file metadata/content
- create or update workflow files
- open pull request
- return operation summary

Key methods:

- `syncWorkflows({ repo, baseBranch, mode, files, force })`
- `loadTemplate(fileName)`
- `upsertWorkflowFile({ owner, repo, branch, path, content, force })`
- `createSyncPullRequest(...)`

### 2. Extend GitHub App Service: `services/githubAppAuth.js`

Add helper(s) returning installation-authenticated Octokit client for repository operations.

Example:

- `getInstallationOctokit(owner, repo)`

### 3. Controller Update: `controllers/deployController.js`

Add handler:

- `syncDeploymentWorkflows(req, res)`

Validation:

- repo format
- mode in allowed set
- files only from managed allowlist
- feature flag enabled

### 4. Routes Update: `routes/deployRoutes.js`

Add:

- `POST /deploy/workflows/sync`

Auth:

- keep `requireAuth`

---

## Security and Safety Controls

- Restrict writes to `.github/workflows/` only
- Allowlist allowed filenames only
- Validate authenticated user can act on requested repository
- Never return installation tokens in response or logs
- Use explicit commit message and PR body explaining managed changes
- Add rate limiting per user/repo for sync endpoint

Suggested commit message:

- `chore(ci): add managed deployment workflows`

Suggested PR title:

- `chore: add platform-managed deployment workflows`

---

## Observability

Add structured logs:

- `workflow_sync_requested`
- `workflow_sync_changed`
- `workflow_sync_skipped`
- `workflow_sync_pr_created`
- `workflow_sync_failed`

Log fields:

- `repo`
- `mode`
- `baseBranch`
- `changedCount`
- `skippedCount`
- `pullRequestUrl`

Metrics to track:

- sync success rate
- avg changed files per sync
- PR creation failure rate
- deploy recovery rate after auto-bootstrap

---

## Test Plan

### Unit Tests

New test file:

- `tests/workflowInjectionService.test.js`

Cases:

- loads templates from local `workflows/`
- creates new files when missing
- updates changed managed file
- skips unchanged files
- blocks unmanaged file overwrite without `force`
- allows overwrite with `force`

### Route/Controller Tests

Extend:

- `tests/server.test.js`

Cases:

- 403 when feature flag disabled
- 400 on invalid mode/files
- 202/200 with PR URL when changes exist
- `no_changes` response when templates already match

### Integration/Smoke

Add smoke flow:

1. call sync endpoint
2. verify PR URL returned
3. merge PR manually
4. call deploy endpoint and verify workflow dispatch succeeds

---

## Rollout Plan

### Stage 1: Internal Pilot

- enable `ENABLE_WORKFLOW_INJECTION=true`
- restrict to internal allowlist repositories
- PR mode only

### Stage 2: Limited External

- open to selected user repos
- track sync success and PR merge rates

### Stage 3: General Availability

- default endpoint available to all authenticated users
- optional direct commit mode behind separate flag

---

## Failure Handling

Common scenarios and responses:

- repo not installed for app -> 404 with clear guidance
- missing app permission -> 403 with required permission hint
- base branch not found -> 422 with branch detail
- PR already exists from sync branch -> return existing PR URL

Return machine-friendly error shape:

```json
{
  "error": "Workflow sync failed",
  "code": "missing_permission",
  "details": "GitHub App must have Workflows:write and Contents:write"
}
```

---

## Backward Compatibility

- Existing deployment endpoints remain unchanged
- Existing deployment behavior remains default
- Workflow injection is additive and behind feature flag

---

## Implementation Checklist

1. Add `ENABLE_WORKFLOW_INJECTION` env support and docs
2. Add workflow injection service
3. Extend GitHub App service helpers for content + PR operations
4. Add `POST /deploy/workflows/sync` endpoint and controller
5. Add structured logging for sync lifecycle
6. Add unit and API tests
7. Update deployment docs with endpoint usage
8. Roll out in PR-only mode

## Recommended MVP Decision

Ship PR-only workflow sync first.

This minimizes repository risk while immediately solving the missing-workflow setup problem and creates a clean foundation for deploy-time auto-bootstrap in a follow-up iteration.
