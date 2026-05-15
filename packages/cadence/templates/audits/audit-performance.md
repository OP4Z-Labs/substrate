---
action: performance
command: audit
schema_version: 1
description: Performance audit — N+1 queries, missing indices, render thrash, bundle bloat, slow paths.
---

# Audit: Performance

Catches the slow paths and bloat that compound over time. Combines
static heuristics (N+1 queries, missing indices) with runtime data when
available (profiling output, bundle reports). Designed to be additive
to dedicated tools, not a substitute for them.

## Inputs

- Optional `--scope backend|frontend|all` (default `all`).
- Optional `--target <service-or-area>` to narrow.

## Output

- `auto/audits/performance/YYYY-MM-DD.md`
- `auto/audits/performance/latest.json`

## Block 1: Pre-flight

- Detect available tooling: ORM logging, query analyzers, bundle
  reporters, Lighthouse / equivalent for frontend.
- Load previous sidecar for trend tracking.

## Block 2: Discovery

- Endpoint count and routes (backend)
- Component count and route count (frontend)
- Asset bundle size (current, if a budgeting tool is wired in)
- Database schema scale: table count, row count for large tables

## Block 3: Run Detectors

### Pass A — Backend: N+1 patterns

- Loop over a query result and issue another query per element: severity
  high.
- ORM lazy loads inside hot paths (no `select_related` / `prefetch_related`
  / `joinedload` equivalent): severity high.
- Repeated identical queries within one request: severity medium
  (caching candidate).

### Pass B — Backend: missing indices

- Predicates on non-indexed columns in queries the audit can identify
  (joins, `WHERE` clauses on tables with row counts above ~10k):
  severity medium.
- Foreign keys without an index on the referencing side: severity high
  (long-lock risk on deletes).

### Pass C — Backend: blocking patterns

- Synchronous I/O in an otherwise-async handler: severity high.
- Long-running operations on the request path that should be queued:
  severity medium.
- Per-request initialization of heavy clients (HTTP, DB, ML): severity
  medium.

### Pass D — Frontend: render thrash

- Components that re-render without prop changes (heuristic: large
  components without memoization and frequently-changing parents):
  severity medium.
- Lists rendering without virtualization above ~200 items: severity
  medium.
- Effect chains that thrash (`useEffect` that updates state that
  triggers another effect): severity high.

### Pass E — Frontend: bundle bloat

- Large libraries imported eagerly from leaf components: severity medium.
- Duplicate libraries across the bundle graph (multiple versions of
  the same package): severity high.
- Route components not lazy-loaded when the route is rarely visited:
  severity low.

### Pass F — Asset and network

- Images not optimized (formats, sizes) for the target viewport:
  severity medium.
- Render-blocking third-party scripts: severity high.
- API responses without compression: severity medium.

## Block 4: Score + Gate

- Standard formula.
- Performance is rarely a hard gate; it's a trend. Use the trend audit
  to track regressions over time.

## Block 5: Diff vs Baseline

- Bundle size delta (gate if a budget is configured)
- New N+1 patterns introduced
- Coverage of perf tests (if any)

## Block 6: Reports

```markdown
---
date: YYYY-MM-DD
bundle_kb: NN
score: NN
---

# Performance audit

## Hot-path findings
## Database findings (N+1, indices)
## Bundle and assets
## Render heuristics
## Recommended fixes (ranked by ROI)
```

## Block 7: Followups

- Pair findings with measurements when possible — "this is slow" is
  much weaker than "this query takes 800ms p99". Run a flame-graph
  pass before opening the optimization task.
- Avoid premature optimization — the audit raises candidates; humans
  decide what to fix.

## Rules

**Do:** correlate findings with real measurements; track bundle and
hot-path latency as time-series; prioritize wins with clear
reproductions.
**Don't:** chase microbenchmarks; assume static heuristics replace
profiling; rewrite working code on a hunch.
