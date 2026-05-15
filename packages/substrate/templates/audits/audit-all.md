---
action: all
command: audit
schema_version: 1
description: Composite codebase health sweep — runs every enabled audit and rolls findings into one report.
---

# Audit: All (composite sweep)

Runs every audit listed in `substrate.config.json`'s `defaults.audits`
(or the subset passed via `--include`), then rolls the results into a
single composite report.

Designed for a periodic deep-pass (monthly is a reasonable cadence) and
for onboarding into a new repo where you want a one-shot read of where
things stand.

## Inputs

- Optional `--include <a,b,c>` — explicit list of audits to run
  (default: every enabled audit).
- Optional `--exclude <a,b,c>` — opt out of specific audits.
- Optional `--fail-fast` — stop at the first failing audit.

## Output

- `auto/audits/all/YYYY-MM-DD.md`
- `auto/audits/all/latest.json`
- Each constituent audit also writes its own report as usual.

## Block 1: Pre-flight

- Resolve the audit list from config + flags.
- Estimate runtime (sum of historical run-times if available) and warn
  if it's going to be long.
- Confirm tooling for every audit is available; surface missing tools
  upfront rather than failing midway.

## Block 2: Run constituent audits

In dependency order where one exists. Most audits are independent;
exceptions:

- `trend` runs last (it consumes the sidecars the others produce).
- `pre-merge` is excluded from the composite by default — it's a fast
  PR gate, not part of the deep sweep.

For each audit:

- Invoke it with default arguments.
- Capture the report path and sidecar path.
- Record runtime, score, gate state.

## Block 3: Roll up

- Per-audit summary row (type, score, gate, finding counts).
- Composite score: mean of audit scores, weighted equally (humans can
  override the weighting in the report narrative).
- Composite gate: worst of the per-audit gates.
- Findings deduplicated where possible — the same source-line flagged
  by two audits collapses to one row in the composite.

## Block 4: Highlight the top issues

The composite report should answer "what should we fix first?" in
under 30 seconds of reading. Surface:

- Every critical finding across audits (with audit-type tag).
- The audit type with the worst score (action: focus next sprint).
- The audit type with the steepest decline since last composite run.
- Coverage gaps (audits that didn't run because tooling was missing).

## Block 5: Reports

```markdown
---
date: YYYY-MM-DD
audits_run: N
composite_score: NN
composite_gate: pass|conditional|fail
runtime_seconds: NN
---

# Codebase health sweep

## Top issues (composite)
## Per-audit summary
| Type | Score | Gate | Critical | High | Medium | Low |
| ---- | ----- | ---- | -------- | ---- | ------ | --- |

## Coverage gaps
## Wins since last composite run
## Recommended focus areas (next sprint)
```

## Block 6: Followups

- File one task per audit type that regressed.
- For audits that improved, note the change so the team knows what
  worked.
- Schedule the next composite run before closing this one — make it a
  rhythm, not an event.

## Rules

**Do:** schedule composite audits on a fixed cadence; treat the
narrative section as the most important output; cite specific audits
when escalating findings.
**Don't:** treat the composite score as the final word — the per-audit
detail is where decisions get made; run this on every PR (use
pre-merge for that).
