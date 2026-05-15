---
scope: infrastructure
area: ci-cd
last_updated: 2026-05-14
rules:
  - INF-CICD-001
update_triggers:
  - Build steps changed
  - Required check added
  - Deploy target added
---

# CI / CD

> **Cadence default standard.** What runs on every PR, what runs on
> merge, and what gates a deploy. CI vendor-neutral (GitHub Actions,
> GitLab CI, CircleCI, Jenkins) — the discipline travels.

## Scope

Every automated build, test, and deploy pipeline.

## Rules

### 1. PR pipeline: fast, gates the merge

Every pull request runs:

1. **Format check** — `prettier --check` / `black --check` etc. Fail
   if the diff has unformatted code.
2. **Lint** — eslint / ruff / clippy. Fail on errors.
3. **Type check** — `tsc --noEmit`, `mypy`, etc.
4. **Unit tests** — fast layer of the pyramid (< 1 minute).
5. **Pre-merge audit** — `cadence audit --diff` (rule `INF-CICD-001`).

Total target: < 5 minutes for the PR pipeline. Slower means PRs
queue, devs context-switch, throughput drops.

Branches that fail any gate cannot merge.

### 2. Merge pipeline: thorough, gates the deploy

After merge to main:

1. Everything from the PR pipeline (re-run for safety).
2. **Integration tests** against ephemeral DB / Redis / etc.
3. **E2E smoke** against the staging environment.
4. **Build artefacts** (Docker images, npm packages, static sites).
5. **Sign / publish artefacts** to the registry.
6. **Deploy to staging** (automatic).
7. **Wait for soak / manual approval** before production.

### 3. Required checks, not optional checks

In the repo settings, mark the PR-pipeline jobs as REQUIRED for
merge. "Run when you remember" is not a quality bar.

### 4. Branches: short-lived, named after the task

```
feat/add-task-bulk-update
fix/auth-refresh-race
chore/bump-deps-2026-q2
```

Lifespan: a few hours to a few days. Long-lived branches accumulate
merge conflicts and divergent decisions.

Trunk-based development (everyone commits to main, gated by PRs) is
the goal. Release branches only for very specific stabilization
phases.

### 5. Commit conventions

Follow conventional commits (or your team's variant):

```
<type>(<scope>): <subject> [<task-id>]

feat(auth): support OAuth2 PKCE flow [TASK-128]
fix(api): handle empty pagination response [TASK-129]
chore(deps): bump react to 19.1.0
```

The commit message style is enforced by a commit-msg hook
(`commitlint` etc.). The task ID lets webhooks correlate commits
with the tracker.

### 6. Builds are reproducible

A build of the same commit produces byte-identical artefacts. Drive
out non-determinism:

- Pin tool versions (Node, Python, system packages).
- Use lockfiles (package-lock.json, poetry.lock, etc.).
- Sort outputs deterministically.
- Don't include timestamps in artefact metadata.

Reproducibility is what makes "git bisect" usable on the artefact
side, and what enables byte-exact comparisons during incident
investigation.

### 7. Secrets via the CI platform's secret store

GitHub Actions secrets, GitLab CI variables, etc. NEVER commit
secrets to the repo (rule `BE-SEC-002`). NEVER print secrets in
logs.

For dynamic secrets (e.g., OIDC-derived cloud creds), use the CI
platform's native federation rather than long-lived static creds.

### 8. Deploy: rolling, with health gates

A deploy:

1. Brings up N+1 instances.
2. Waits for the new instances' `/ready` endpoint.
3. Drains the old instances.
4. Brings them down.

The orchestrator (k8s, ECS, Nomad) does this; configure the health
check correctly so failed instances don't take traffic.

Rolling deploys with a healthy gate are the difference between "we
shipped a bug, rolled it back, no users affected" and "we shipped a
bug, all 12 boxes restarted, full outage."

### 9. Rollbacks are a first-class operation

Every deploy is reversible by the next person on-call:

```bash
./scripts/rollback.sh <env> <version>
```

Or via the CI's "deploy previous version" button. The runbook for
rollback lives in `operations/runbooks.md` and is rehearsed in
quarterly chaos days.

If rollback requires schema migration (rare), the expand/contract
pattern from `operations/database-ops.md` makes it possible. If
not (data destruction migration), document the irreversibility
explicitly in the release notes.

### 10. Environments are immutable

Production, staging, preview / pull-request environments are
treated as cattle, not pets. Don't SSH in and tweak settings;
everything is config-as-code.

When something IS tweaked by hand during an incident, it's logged
in the incident postmortem AND landed in code within the week.

### 11. Caches: aggressive, with explicit busts

CI is mostly waiting on cache hits:

- Node modules: cache by `package-lock.json` hash.
- Python deps: cache by `poetry.lock` hash.
- Docker layers: BuildKit / buildx with registry caching.
- Test runner output: cache between matrix shards.

Cache invalidation is the second-hardest problem in CS; the fix is
"key the cache on the right things and trust it." If you find
yourself manually clearing CI cache, the key was wrong.

### 12. Dependabot / Renovate keeps deps fresh

A bot proposes weekly PRs for dependency bumps. The team reviews +
merges them on a cadence. Stale deps become the security debt
described in `backend/security.md`.

## Examples

### Do — fast, gated PR pipeline

```yaml
# .github/workflows/pr.yml
on: pull_request
jobs:
  format:
    runs-on: ubuntu-latest
    steps: [..., run: npm run format:check]
  lint:
    runs-on: ubuntu-latest
    steps: [..., run: npm run lint]
  typecheck:
    needs: lint
    steps: [..., run: npm run typecheck]
  unit:
    needs: lint
    steps: [..., run: npm test -- --reporter=verbose]
  audit:
    needs: lint
    steps:
      - uses: BeauGoldberg/cadence@v1
        with: { command: "audit --diff", fail-on: error }
```

### Don't — single monolithic job

```yaml
build-test-deploy:
  steps:
    - run: npm install
    - run: npm run lint && npm test && npm run build && npm run deploy
```

One failure kills the whole run; you re-run everything; iteration
takes 20 minutes.

## Rationale

CI/CD discipline is what makes "ship every day" possible. The
conventions above front-load the cost (gated checks, immutable
environments, deterministic builds) and earn back delivery speed.

## See also

- `docker.md` — build images.
- `operations/runbooks.md` — rollback procedure.
- `operations/database-ops.md` — schema migration in deploys.
- `backend/testing.md` / `frontend/testing.md` — what the test stages run.
