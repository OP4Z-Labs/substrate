---
action: reusability
command: audit
schema_version: 1
description: Finds duplicated logic that should be a shared package or utility.
---

# Audit: Reusability

Surfaces code that has been quietly copy-pasted across services, apps,
or features. The goal isn't DRY for DRY's sake — it's to identify the
candidates for shared packages before drift sets in.

## Inputs

- Optional `--scope` to narrow (`backend | frontend | all`, default
  `all`).
- Optional `--threshold <N>` — minimum number of duplications to surface
  (default 3).

## Output

- `auto/audits/reusability/YYYY-MM-DD.md`
- `auto/audits/reusability/latest.json`

## Block 1: Pre-flight

- Verify any code-similarity tooling you depend on is available
  (`jscpd`, `pylint --disable=all --enable=duplicate-code`, language
  duplication detectors, or raw ripgrep heuristics).
- Load the previous sidecar.

## Block 2: Discovery

- Total lines of code in scope
- Existing shared packages (count and total LOC)
- Cross-cutting concerns already extracted (logging, auth, telemetry,
  HTTP client, ...)

## Block 3: Run Detectors

### Pass A — Lexical duplication

Run a duplication detector with a meaningful threshold (e.g. ~30 lines
of similarity). Report:

- Cluster size (number of copies)
- Token similarity
- Location of each copy
- Tentative classification (utility / domain / boilerplate)

Severity tiers:

- 4+ copies of a non-trivial block (>50 lines): severity high.
- 3 copies of a meaningful block (>30 lines): severity medium.
- 2 copies: tracked but typically low — the bar for extraction is "use
  it three times, then extract".

### Pass B — Conceptual duplication

Patterns that lexical detectors miss:

- Same data validation logic implemented in multiple places (e.g.
  email regex appears in 5 services).
- Same fetch + retry + error-handling pattern reimplemented per call site.
- Repeated configuration parsing.

These usually need a human read — surface as candidates, not
findings.

### Pass C — Cross-stack duplication

If you have the same domain logic implemented in both backend and
frontend (e.g. tax calculation), flag it. The fix is usually a shared
schema or a server-side compute — not a copy reconciliation.

### Pass D — Boilerplate ceremony

Repeated import blocks, repeated setup-teardown patterns in tests,
repeated logging-init calls. Lower severity than logic duplication but
collectively a source of friction.

## Block 4: Score + Gate

- Standard formula. Reusability is rarely a gate — it's an investment
  signal. Use the trend audit to track whether duplication is rising or
  falling over time.

## Block 5: Diff vs Baseline

- New duplication clusters since last run
- Resolved clusters (a shared package was extracted)
- Cluster growth (an existing cluster grew by N copies)

## Block 6: Reports

```markdown
---
date: YYYY-MM-DD
clusters: N
extracted_since_last: N
---

# Reusability audit

## High-priority clusters (4+ copies)
## Medium clusters (3 copies)
## Cross-stack duplication
## Conceptual duplications (manual review)
## Recommended extractions (top 3)
```

## Block 7: Followups

- For each high-priority cluster, write a one-paragraph extraction
  proposal: which package, what API, who owns it.
- Tag clusters with their domain — sometimes the "right" extraction is
  three packages (`logging`, `http-client`, `config`) not one.

## Rules

**Do:** prioritize extractions that have a clear seam; track cluster
growth — a cluster that keeps growing is a tax that compounds.
**Don't:** extract on the second duplication (rule of three); merge
clusters across unrelated domains just because the code shapes match.
