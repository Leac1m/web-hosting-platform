# Deployment Readiness Implementation Plan

## 1) Current System Understanding

### Product behavior today

- Frontend (React + Vite) lets authenticated users:
  - log in with GitHub OAuth
  - pick repositories from GitHub App installation scope
  - trigger deployments to either `github-pages` or `platform`
  - monitor deployment status and Pages configuration
- Backend (Express) handles:
  - OAuth session auth via cookie
  - deployment trigger dispatch to GitHub Actions workflows
  - optional workflow file sync into target repositories
  - GitHub Pages configuration/sync and health checks
  - artifact upload and extraction for `platform` target
  - relay serving for `/sites/:project` and root-asset fallback
- Deployment status is persisted in `server/db.json` through `deployStatusStore`.

### Existing strengths

- Clear separation of concerns across controllers/services/routes.
- Feature flags for GitHub Pages and workflow injection.
- Good error mapping in GitHub-related services.
- Existing tests for key server flows and services.
- Managed workflow templates stored in repository and syncable.

---

## 2) Deployment-Readiness Gaps (What still blocks production confidence)

### Platform and runtime

- Port is hardcoded to `3000` in `server/index.js` (no `PORT` override).
- Session storage is in-memory (`Map`) only; sessions are lost on restart and not multi-instance safe.
- CORS allows only one frontend origin string and no multi-origin strategy.
- No explicit reverse-proxy/trust-proxy handling for secure cookies behind load balancers.

### Security

- No explicit rate limiting on sensitive routes (`/auth/*`, `/deploy/*`, `/api/github/*`, webhook).
- No CSRF protection on cookie-authenticated mutating endpoints.
- Webhook signature check is optional by env (good), but production-hard requirement is not enforced.
- Artifact extraction does not currently enforce tar entry safety checks before extraction.

### Reliability and operations

- Health/readiness/liveness endpoints are missing.
- No graceful shutdown logic for SIGTERM/SIGINT.
- Logging is structured JSON, but lacks request correlation IDs and log levels.
- No alerting/metrics plan captured in repo for deployment SLOs.

### Data and persistence

- Deployment status persistence is file-based (`db.json`), which is fragile on ephemeral or scaled platforms.
- No migration path documented for moving status store to durable DB/Redis.

### CI/CD and quality gates

- Frontend has no test suite in repository.
- No root CI workflow that runs lint/test/build for both frontend and server before release.
- No release tagging/versioning strategy documented.

### Documentation and runbooks

- Good deployment docs exist, but no production runbook for incident response, rollback, or GitHub outage handling.
- No explicit environment matrix (dev/staging/prod) with required variable sets and examples.

---

## 3) Target State (Definition of Ready)

The platform is considered deployment-ready when all are true:

1. Service can run in production behind proxy with secure cookies and configurable port.
2. Auth/session layer survives restarts and supports horizontal scaling.
3. Security controls exist for rate limits, CSRF, webhook signature enforcement, and safe artifact extraction.
4. CI gates enforce lint/test/build on every PR and main branch merge.
5. Observability includes health endpoints, structured logs with request IDs, and baseline metrics/alerts.
6. Rollback and incident runbooks exist and are validated in staging.

---

## 4) Phased Implementation Plan

## Phase 0 - Baseline hardening and inventory (0.5-1 day)

### Tasks

- Add `PORT` support and default fallback.
- Add startup validation for critical production vars when `NODE_ENV=production`.
- Add environment profile docs for dev/staging/prod.
- Capture current API contracts and deployment flow diagrams.

### Deliverables

- Updated `server/index.js` port configuration.
- Updated env docs (`example.env` + deployment docs).
- Baseline architecture/readiness checklist committed.

### Exit criteria

- Service boots with `PORT` and validates prod-required env settings.

## Phase 1 - Security controls (1-2 days)

### Tasks

- Add rate limiting middleware (route-group based).
- Add CSRF strategy for cookie-auth endpoints (double-submit token or same-site strict policy + endpoint token checks).
- Enforce `GITHUB_WEBHOOK_SECRET` in production for `/webhooks/github`.
- Harden artifact extraction with explicit tar path safety checks before write.
- Add security headers via middleware (`helmet`-style config).

### Deliverables

- Middleware stack in `server/server.js` for security.
- Artifact upload path hardened in `server/controllers/deployController.js`.
- Tests for webhook signature-required behavior and blocked unsafe archive entries.

### Exit criteria

- Security smoke tests pass; penetration checklist items closed for exposed endpoints.

## Phase 2 - Session and persistence reliability (1-2 days)

### Tasks

- Replace in-memory session map with durable store (Redis preferred).
- Make cookie options production-safe with `trust proxy` support.
- Replace file-based deployment status persistence with Redis or SQL table.
- Add retry and timeout policies for upstream GitHub API requests.

### Deliverables

- Session service abstraction and Redis-backed implementation.
- Deployment status store abstraction and persistent backend implementation.
- Migration script/adapter from `db.json` to new store (if data retention needed).

### Exit criteria

- Restart of server does not log users out unexpectedly and does not lose deployment states.

## Phase 3 - Observability and operations (1 day)

### Tasks

- Add `/healthz`, `/readyz`, `/livez` endpoints.
- Add request IDs and include them in all logs and error responses.
- Add deployment metrics counters/timers (success, failed, latency by hosting target).
- Add graceful shutdown handling for active requests and temp files.

### Deliverables

- Health endpoints and structured request lifecycle logging.
- Ops documentation for dashboards and alert thresholds.

### Exit criteria

- Staging environment health probes pass; alerts can detect failure and recovery.

## Phase 4 - CI/CD production gates (1 day)

### Tasks

- Add root or coordinated CI workflow:
  - frontend lint + build
  - server tests
  - optional integration smoke test
- Add branch protection requirements tied to CI status checks.
- Add release workflow (version tag + changelog + deployment job trigger).

### Deliverables

- `.github/workflows/ci.yml` and release workflow file(s).
- Updated contributor docs with required checks.

### Exit criteria

- No merge to main without passing quality gates.

## Phase 5 - Staging validation and go-live (0.5-1 day)

### Tasks

- Deploy to staging with production-equivalent config.
- Execute e2e checklist:
  - OAuth login/logout
  - repository list
  - `github-pages` deployment trigger/status/config/sync
  - `platform` artifact upload flow
  - relay serving checks for `/sites/:project` and root assets
- Run rollback drill.

### Deliverables

- Signed-off staging validation report.
- Go-live checklist with owners and timestamps.

### Exit criteria

- All critical and high issues resolved; rollback tested successfully.

---

## 5) Concrete Change List by File Area

### Server runtime

- `server/index.js`: use `process.env.PORT`, graceful signal handling bootstrap.
- `server/server.js`: trust proxy, security middleware, request ID middleware, health endpoints.

### Auth/session

- `server/controllers/authController.js`: replace in-memory sessions with store adapter.
- `server/routes/authRoutes.js`: add CSRF token issue/verify route if using token approach.

### Deployment flow

- `server/controllers/deployController.js`: tar safety checks, stricter artifact validation, timeout handling.
- `server/services/deployStatusStore.js`: migrate from file persistence to durable store abstraction.

### GitHub integration

- `server/controllers/githubController.js`: production guardrails for webhook secret enforcement.
- `server/services/githubRepoService.js` and `server/services/githubPagesService.js`: retry/backoff + telemetry wrappers.

### Frontend

- `frontend/src/services/api.js`: support CSRF token header if enabled.
- `frontend/src/App.jsx`: minor UX handling for new security/health error messages.

### CI and docs

- Add CI workflow(s) under `.github/workflows/`.
- Update `DEPLOYMENT.md`, `example.env`, and add `RUNBOOK.md`.

---

## 6) Testing Strategy for Readiness

1. Unit tests:

- security middleware behavior
- session store adapter
- deploy status persistence adapter
- tar extraction safety checks

2. Integration tests:

- authenticated deploy endpoints with CSRF/rate limit behavior
- webhook verification required in production mode
- health endpoints and readiness logic

3. Staging e2e:

- full deploy lifecycle for both targets
- Pages relay routing correctness with absolute asset paths
- failure injection (GitHub API timeout, invalid credentials)

4. Non-functional:

- restart resilience test
- basic load test on status/list endpoints

---

## 7) Rollback Plan

1. Keep feature flags for new controls (`ENABLE_STRICT_WEBHOOK`, `ENABLE_CSRF`, `ENABLE_REDIS_SESSIONS`) and roll out progressively.
2. If deploy failures spike, disable strict controls in order of impact while preserving authentication and authorization.
3. Maintain previous workflow templates for one release cycle.
4. Revert release by tag and restore previous environment variable set.

---

## 8) Ownership and Timeline (Suggested)

- Day 1: Phase 0 + Phase 1 start
- Day 2: Finish Phase 1 + Phase 2
- Day 3: Phase 3 + Phase 4
- Day 4: Phase 5 staging validation + production cut

Owner mapping suggestion:

- Backend lead: phases 1-3
- DevOps/Platform: phase 4 + infra + alerts
- QA/Engineer: phase 5 validation

---

## 9) Immediate Next Actions

1. Implement `PORT` + health endpoints first (low risk, high ops value).
2. Introduce Redis-backed sessions and deployment status store abstraction.
3. Add CI workflow with required checks before any production cut.
4. Enforce webhook secret + archive extraction safety before enabling external traffic.
