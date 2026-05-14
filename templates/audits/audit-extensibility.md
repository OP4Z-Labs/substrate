---
action: extensibility
command: audit
schema_version: 1
description: Finds magic numbers, hardcoded paths, and closed-for-extension patterns that lock the codebase in.
---

# Audit: Extensibility

Looks for the small choices that make a codebase hard to evolve: magic
numbers, hardcoded paths, switch statements that grow per-domain, and
single-implementation interfaces that have hardcoded their consumer.

## Inputs

- Optional `--scope <area>` — narrow to a directory subtree.

## Output

- `auto/audits/extensibility/YYYY-MM-DD.md`
- `auto/audits/extensibility/latest.json`

## Block 1: Pre-flight

- Locate config files / constants files that should be the home for
  values you might find inlined elsewhere.
- Load the previous sidecar.

## Block 2: Discovery

- Total lines of code in scope
- Existing constants modules / config surfaces
- Existing extension points (registries, plugin interfaces)

## Block 3: Run Detectors

### Pass A — Magic numbers

- Numeric literals other than 0, 1, -1, 100 appearing in business logic
  (excluding clearly-typed array indices and powers of 2 in low-level
  code): severity medium.
- Magic timeouts (`setTimeout(fn, 30000)`, `sleep(30)`): severity high
  (these are operational; they should be named constants or config).
- Magic limits (page sizes, retry counts): severity medium.

### Pass B — Hardcoded paths

- Absolute paths in source (`/usr/local/...`, `C:\Program Files\...`):
  severity critical.
- Repo-relative paths that assume a fixed layout: severity medium.
- URLs hardcoded in source: severity high (move to config).

### Pass C — Closed-for-extension patterns

- Long switch / if-elif chains on a type discriminator (5+ branches in
  one function): severity medium. Suggest a registry / strategy pattern.
- Direct imports of concrete implementations where an interface would
  let the consumer swap: severity low.
- Inline configuration that conflates concerns (auth + database +
  feature flags in one settings object without seams): severity medium.

### Pass D — Configuration discipline

- Settings read from env vars in many places rather than through one
  typed config surface: severity medium.
- Settings without defaults — every consumer must remember to provide
  them: severity medium.
- Configuration validated at use-time rather than load-time: severity
  high (errors surface in the wrong place).

### Pass E — Naming for extension

- `XxxImpl`, `XxxFactory`, `XxxManager` suffixes when only one impl
  exists: severity low (architectural cargo-cult; not always wrong, but
  worth questioning).
- Single-implementation interfaces with no plan for a second: severity
  low.

## Block 4: Score + Gate

- Standard formula. Extensibility is rarely an *immediate* gate but a
  rising score over time correlates with refactor pain.

## Block 5: Diff vs Baseline

- New magic numbers introduced
- New hardcoded paths
- Switch chains that grew (signal that a registry pattern is overdue)

## Block 6: Reports

```markdown
---
date: YYYY-MM-DD
score: NN
---

# Extensibility audit

## Magic numbers / strings (top 10)
## Hardcoded paths
## Closed-for-extension hotspots
## Configuration findings
## Recommended refactors
```

## Block 7: Followups

- For each magic timeout, propose a named constant or config key with
  a default. Don't aspire to make everything tunable — *operationally
  relevant* values should be tunable; pure correctness invariants should
  not.
- For switch chains, draft the registry interface before opening the
  refactor task.

## Rules

**Do:** prioritize operational extensibility (timeouts, limits, URLs)
over architectural extensibility (every interface gets a factory);
suggest refactors with worked examples.
**Don't:** make everything pluggable — choose seams deliberately;
ignore magic strings just because lexers can't tell which ones matter.
