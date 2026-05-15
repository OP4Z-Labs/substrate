---
action: functionality-gaps
command: audit
schema_version: 1
description: Surfaces TODO/FIXME density, untested critical paths, half-implemented features, and known-broken edges.
---

# Audit: Functionality Gaps

Finds the rough edges that accumulate when a feature ships under time
pressure: TODOs without owners, paths the team knows are broken,
untested code on critical paths, and feature flags that have been "on"
for so long they should be removed.

## Inputs

- Optional `--scope <area>` to narrow.
- Optional `--older-than <days>` — only surface TODOs older than N days
  (default 90).

## Output

- `auto/audits/functionality-gaps/YYYY-MM-DD.md`
- `auto/audits/functionality-gaps/latest.json`

## Block 1: Pre-flight

- Verify `git blame` is available (we need the age of TODO lines).
- Load the previous sidecar so we can track which gaps persisted.

## Block 2: Discovery

- Total source files in scope
- Existing TODO / FIXME / HACK / XXX count
- Tests count vs source files count
- Feature flags currently in use (parse from your flag config)
- Open known-issues docs (`KNOWN_ISSUES.md`, similar)

## Block 3: Run Detectors

### Pass A — TODO density

- Files with more than ~5 TODOs: severity medium.
- TODOs older than 90 days without an owner / task ID reference:
  severity medium.
- TODOs older than 180 days at all: severity high — either fix or
  delete.
- `FIXME` / `HACK` / `XXX` markers: severity medium regardless of age.

### Pass B — Untested critical paths

Heuristics for "critical":

- Files with names matching `*auth*`, `*payment*`, `*billing*`,
  `*permission*`, `*tenant*`: severity high if test coverage is below
  ~80% (or no test file at all).
- Functions exported from packages that consumers depend on: severity
  high if no test exists.
- Migration / data-pipeline code: severity high if no test.

### Pass C — Half-implemented features

- Functions that `raise NotImplementedError` / `throw "not implemented"`
  in the main branch: severity high.
- Commented-out code blocks larger than ~20 lines: severity medium
  (the team is hedging — finish or delete).
- Multiple sibling files with similar names suggesting an abandoned
  refactor (`auth_service.py` + `auth_service_v2.py`): severity medium.

### Pass D — Feature-flag rot

- Flags that have been at `enabled = true` for over 30 days: severity
  medium (likely safe to remove).
- Flags referenced in code but not in the flag config: severity high
  (the flag is dead, but the conditional remains).
- Flags in config but never referenced in code: severity medium
  (orphan).

### Pass E — Documentation gaps

- README mentions a command / endpoint / feature that no longer exists:
  severity medium.
- Setup / install steps that are out of date: severity medium.
- Architecture diagram older than the latest service: severity low.

### Pass F — Known-issue documents

If your repo has `KNOWN_ISSUES.md` (or equivalent):

- Issues that have been open longer than 90 days: surface, severity
  medium (review whether they're still relevant).
- Issues without a workaround: severity high.

## Block 4: Score + Gate

- Standard formula. The score correlates with technical debt; the
  trend over time matters more than any single reading.

## Block 5: Diff vs Baseline

- New TODOs since last run
- Resolved TODOs (celebrate)
- TODOs that aged past a threshold (escalation)
- New feature flags / removed feature flags

## Block 6: Reports

```markdown
---
date: YYYY-MM-DD
todos: N
old_todos: N
untested_critical_paths: N
flag_rot: N
---

# Functionality gaps audit

## TODO density
## Untested critical paths
## Half-implemented features
## Feature-flag rot
## Documentation drift
## Recommended cleanups (ranked)
```

## Block 7: Followups

- Convert long-lived TODOs into tracked tasks or delete them.
- For each untested critical path, write the test before the next
  feature on that area lands.
- Schedule a feature-flag cleanup every quarter.

## Rules

**Do:** treat TODOs as debt that compounds; align critical-path
heuristics with your actual high-risk areas; remove flags that have
"settled".
**Don't:** let TODOs become a parking lot; mistake "covered by an
integration test" for "tested" — both matter.
