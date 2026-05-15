---
action: backend
command: audit
schema_version: 1
description: Service-level health check for backend services — directory structure, async patterns, service-layer discipline, error handling, observability.
---

# Audit: Backend Service

A service-level review designed for one backend service at a time
(e.g. `auth-service`, `billing-service`). Targets the structural and
behavioural patterns that compound over time: layering, async hygiene,
error handling, and observability.

## Inputs

- **`--target <service-name>`** — required; the service directory under
  your `paths.backend` (e.g. `apps/backend/auth-service`).
- Optional `--rules <ID,ID>` — restrict to a subset of `BE-*` rules from
  the RULES registry.

## Output

- `auto/audits/backend/<target>-YYYY-MM-DD.md`
- `auto/audits/backend/<target>-latest.json` (sidecar for trend tracking)

## Block 1: Pre-flight

- Verify the target directory exists and contains the conventional
  service layout (an `app/` or `src/` root with `api`, `services`,
  `schemas`, and `db` siblings — names may vary by stack).
- Load `RULES.yaml` (or your project's equivalent). All rules with
  scope `BE-*` are in scope unless `--rules` narrows further.
- Load previous sidecar at `auto/audits/backend/<target>-latest.json` so
  diff-vs-baseline can fire.

## Block 2: Discovery

Surface the shape of the service before judging it:

- Lines of code in `app/`, broken down by `api`, `services`, `db`, `schemas`
- Endpoint count (handler functions in the API layer)
- Service-class count
- Test file count + ratio test-to-source
- Dependencies (runtime + dev) — count and most-recent-update median

## Block 3: Run Detectors

### Pass A — Layering

The endpoint layer should orchestrate; business logic lives in services.

- Direct database calls (`select(`, `update(`, raw SQL) in the API layer:
  severity high.
- Business logic patterns (loops, conditionals beyond simple validation)
  in handler bodies: severity medium.
- Service classes that reach into HTTP request state: severity medium.

### Pass B — Async hygiene

If the stack supports async (asyncio, async/await):

- Sync handlers in an otherwise async service: severity high.
- `time.sleep` / blocking I/O inside async functions: severity high.
- Missing `await` on coroutine results: severity critical (correctness).

### Pass C — Error handling

- Bare `except:` / `catch (e)` swallowing all errors: severity high.
- Returning success on partial failure (e.g. silently logging then
  returning 200): severity high.
- Missing error response schema on documented endpoints: severity medium.

### Pass D — Observability

- Endpoints without structured logging on the success path: severity medium.
- Errors logged without correlation IDs (when correlation IDs are
  available via middleware): severity medium.
- Metrics counters absent from critical paths: severity low.

### Pass E — Configuration

- Hardcoded URLs / hosts / credentials in source: severity critical.
- Configuration read from environment without a single typed config
  surface: severity medium.
- Missing health-check endpoint: severity medium.

## Block 4: Coverage

If your stack supports it, run the test suite with coverage and capture:

- Overall % for `app/` (or `src/`)
- Per-module % (services, api, db)
- Untested critical paths (handlers without a corresponding test)

Threshold suggestion: **services ≥ 70%, packages ≥ 90%**. Adjust per
project — record the choice in your standards doc.

## Block 5: Diff vs Baseline

Compare against the previous sidecar:

- New high/critical findings introduced
- Resolved findings (surface them — wins matter)
- Findings older than 14 days (escalate)
- Coverage delta (a drop > 2pp triggers a warning)

## Block 6: Score + Gate

Standard score formula:

- Score = 100 − Σ(severity × weight). Weights: critical=20, high=8, medium=3, low=1.
- Gate: pass (≥ 90), conditional (≥ 75), fail (< 75).
- Any introduced critical finding → fail, regardless of score.

## Block 7: Reports

Markdown report sections:

```markdown
---
target: <service>
date: YYYY-MM-DD
score: NN
gate: pass|conditional|fail
---

# Backend audit: <service>

## Summary
Score, gate, deltas vs baseline.

## Findings by severity
Critical | High | Medium | Low

## Coverage
Overall and per-module.

## Recommended actions
Top 3 follow-ups, sized.
```

JSON sidecar mirrors the same data in machine-readable form.

## Block 8: Followups

- Open tasks for any critical or high findings.
- Schedule a follow-up audit after the next ship.
- If three audits in a row show no progress on a finding, escalate to
  a refactor task rather than another fix-the-symptom pass.

## Rules

**Do:** scope to one service per run; baseline comparisons drive the
narrative; cite rule IDs in findings.
**Don't:** roll backend + frontend into one audit (use `audit --type all`
for that); skip coverage just because tests are slow.
