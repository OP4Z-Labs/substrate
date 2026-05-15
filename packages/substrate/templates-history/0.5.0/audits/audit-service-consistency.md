---
action: service-consistency
command: audit
schema_version: 1
description: Cross-service consistency audit — pattern drift across multiple services in the same repo.
---

# Audit: Service Consistency

Designed for multi-service repos. Compares the shape of every backend
service against a baseline pattern so drift between them is visible.
Useful before adding a new service, and after a sprint where multiple
services changed in parallel.

## Inputs

- Optional `--baseline <service>` — the gold-standard service to compare
  against. Defaults to the first service alphabetically when omitted.

## Output

- `auto/audits/service-consistency/YYYY-MM-DD.md`
- `auto/audits/service-consistency/latest.json`

## Block 1: Pre-flight

- Enumerate services under `paths.backend` (or your repo's equivalent).
- If fewer than two services exist, exit with a friendly note —
  consistency only matters when there are multiple things to compare.
- Pick the baseline service.

## Block 2: Discovery

For each service, record:

- Directory layout — which canonical subdirs are present (`api`,
  `services`, `db`, `schemas`, `tests`, `migrations`)
- File-name conventions (snake_case, camelCase, ...)
- Required entry files (`main`, `app`, `logging`, `config`)
- Test infrastructure (conftest, helpers)
- Build artifacts (Dockerfile, entrypoint, healthcheck)

## Block 3: Run Detectors

### Pass A — Layout drift

- Service is missing a subdir the baseline has: severity medium.
- Service has a subdir the baseline lacks (and it's not opt-in): severity
  low — flag for discussion, not a fix.

### Pass B — Naming drift

- File-name casing diverges from the baseline (snake vs camel): severity
  low.
- Module names diverge for the same concept (`auth_service.py` vs
  `auth-service.py`): severity medium.

### Pass C — Boilerplate drift

- Required entry file missing (e.g. `app/logging.py` exists in baseline
  but not in this service): severity high.
- Entry file present but its contents diverge significantly from baseline
  (more than ~20% line-level diff): severity medium.

### Pass D — Test infrastructure drift

- `conftest` or test helpers missing: severity medium.
- Different test framework or runner per service: severity high
  (cognitive overhead).

### Pass E — Deployment artifacts

- Dockerfile structure diverges (multi-stage vs single-stage; different
  base images for the same language): severity medium.
- Health-check endpoint missing on a service that has one in the baseline:
  severity high.
- Entrypoint scripts diverge: severity low.

### Pass F — Dependencies

- Same library on different majors across services: severity high
  (security and behavior drift).
- Same library on different minors: severity medium.
- Service-specific dependencies that should be shared (logging, telemetry,
  HTTP client): severity medium.

## Block 4: Score + Gate

- Standard formula. The score here is more diagnostic than gating:
  consistency is a long arc, not a per-PR concern.
- Surface the *worst-drift* service in the report so teams know where
  to focus.

## Block 5: Diff vs Baseline

- Did this run introduce new drift?
- Did any drift resolve since last run? (Surface the win.)

## Block 6: Reports

```markdown
---
date: YYYY-MM-DD
baseline: <service>
services: N
---

# Service-consistency audit

## Baseline summary
## Per-service drift
## Drift categories (layout / naming / deps / ...)
## Worst-drift service
## Recommended fixes
```

## Block 7: Followups

- For high-severity drift, schedule a refactor task.
- For low-severity style drift, accept and update the baseline if the
  drift represents an improvement.
- Review every six months whether the baseline should itself move.

## Rules

**Do:** pick a baseline deliberately; treat drift as a leading indicator;
look for *systemic* drift (every service does X differently) versus
*one-off* drift (one service is out of sync).
**Don't:** auto-fix drift — many cases are intentional; mistake "different"
for "worse" without understanding why.
