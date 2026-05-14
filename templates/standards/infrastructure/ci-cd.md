---
scope: infrastructure
area: ci-cd
last_updated: TODO
rules:
  - INF-CICD-001
update_triggers:
  - CI provider changes
  - Pipeline structure changes
---

# CI / CD Standards

> Cadence scaffold — fill in the TODOs.

How code moves from commit to production.

## 1. CI provider

TODO: GitHub Actions, GitLab CI, CircleCI, Buildkite, etc. Where the
workflow files live.

## 2. Pipeline stages

TODO: Standard stages and what runs in each.

| Stage   | Triggers      | Runs                                    |
| ------- | ------------- | --------------------------------------- |
| Lint    | every commit  | linters, formatters                     |
| Test    | every commit  | unit tests, type checks                 |
| Build   | every commit  | compile artifacts                       |
| Audit   | PRs to main   | `cadence audit --type pre-merge`        |
| Deploy  | merge to main | environment-specific deploy             |

## 3. Required checks per PR

TODO: Which checks block merge. Whether they're configurable per repo
or required across all PRs.

## 4. Caching

TODO: Build cache strategy. Dependency cache key. Cache size budget.

## 5. Secrets

TODO: Where they live (CI provider's secret store). Rotation policy.
Which environments have which.

## 6. Environment promotion

TODO: dev → staging → production. What triggers each promotion.
Approval gates.

## 7. Rollback

TODO: How rollback happens. Time-to-rollback target.

## 8. Branch protection

TODO: Rules on `main` (require PR review, required checks, signed
commits).

## 9. Build artifacts

TODO: Where artifacts are stored. Retention policy. Provenance.

## 10. Observability of CI itself

TODO: Build time trends. Failure rate per workflow. Flaky test
tracking.
