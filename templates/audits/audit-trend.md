---
action: trend
command: audit
schema_version: 1
description: Aggregates audit scores over time. Read-only — does not run detectors, just summarizes the sidecars.
---

# Audit: Trend

Aggregates the per-audit `*-latest.json` sidecars into a time-series
view. Useful for the "is this codebase getting better or worse?"
question that any one audit can't answer alone.

## Inputs

- Optional `--window <days>` — how far back to look (default 90).
- Optional `--types <a,b,c>` — restrict to specific audit types.

## Output

- `auto/audits/trend/YYYY-MM-DD.md`

## Block 1: Pre-flight

- Walk `auto/audits/` and find every `*-latest.json` and any dated
  reports in the window.
- For each audit type, build a list of `(date, score, finding_counts)`.

## Block 2: Discovery

- Audit types currently active (those with at least one report in the
  window)
- Reports per type in the window
- Coverage gaps (audit types listed in `cadence.config` defaults but
  with no reports in the window)

## Block 3: Aggregate

For each audit type:

- Latest score and gate state
- Median score over the window
- Score trajectory (linear fit slope, in points per week)
- Findings-by-severity counts over the window
- New / resolved finding counts since the previous report

For the repo as a whole:

- Mean of latest scores across audit types
- Number of audits in `pass` / `conditional` / `fail` state
- Audit types that haven't run in the window (coverage gap)

## Block 4: Detect inflection points

Flag anything anomalous:

- A score drop of more than 10 points between two consecutive runs:
  severity medium (investigate the diff between the two runs).
- A score that has trended down for 3+ runs in a row: severity high
  (sustained regression).
- An audit type that hasn't run in 30+ days: surface as a coverage gap.

## Block 5: Reports

```markdown
---
date: YYYY-MM-DD
window_days: 90
audits_tracked: N
---

# Trend audit

## Per-audit-type summary
| Type | Latest | Median | Trend | Last run |
| ---- | ------ | ------ | ----- | -------- |

## Inflection points
## Coverage gaps (audits not run recently)
## Recommended actions
```

## Block 6: Followups

- For sustained regressions, link to the most recent audit report so
  someone can dig in.
- For coverage gaps, schedule the missing audit type.
- Update this trend audit on a cadence — once a sprint or once a month
  is usually right.

## Rules

**Do:** treat the trend as the team's pulse; investigate sudden drops
even if the absolute score is still passing.
**Don't:** chase the score for its own sake — context matters; ignore
coverage gaps just because the existing audits pass.
