# Audit — Composite (aggregates sub-audit findings)

## Purpose

This workflow demonstrates **Primitive 6 — `composes_findings_of`**.
It aggregates findings from sub-audits while letting the runtime
guarantee each sub-audit's data is fresh.

## How composition works

The manifest declares dependencies:

```yaml
composes_findings_of:
  - workflow: audit-service
    section: "Service-scoped findings"
    require-fresh-within: 7d
  - workflow: audit-package
    section: "Package-scoped findings"
    require-fresh-within: 7d
```

Before this workflow runs, the runtime:

1. Looks up each dependency's latest sidecar at
   `substrate/audits/<workflow-id>-latest.json`.
2. Compares the sidecar's `generatedAt` against the
   `require-fresh-within` duration (here, 7 days).
3. Surfaces a warning at workflow start when any dependency is stale
   or missing.

Stale-dependency warnings do **not** fail the workflow — they're
advisory. The author can decide whether to refresh sub-audits before
proceeding.

## Steps

1. **`run-detector`** — Re-runs `substrate audit --json` to refresh
   the composite findings against the current tree.

## When to use this workflow

When you want a single "composite health" call that combines the
output of several focused audits. The composition primitive
guarantees you're not aggregating stale sub-audit data without
warning.

## Adjusting freshness windows

`require-fresh-within` accepts: `<n>s`, `<n>m`, `<n>h`, `<n>d`,
`<n>w`. Pick a window that matches how often the sub-audit's input
changes — frequently-changing services warrant tighter windows
(e.g. `1d`), stable packages can stretch to `30d`.
