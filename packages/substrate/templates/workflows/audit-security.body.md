# Security-focused audit

Restricts the audit pass to security-classified rules
(`BE-SEC-*`, `FE-SEC-*`, `INF-SEC-*`, `XCUT-SEC-*`) and adds an
AI analysis step that categorises findings by exploit severity.

## Why a separate workflow

The default `substrate audit` runs every rule — including style /
maintainability checks that produce a lot of low-severity noise. For
security review, the signal-to-noise ratio matters more than coverage:
a single critical SQL-injection finding is worth more than 50
style-rule violations.

This workflow filters to security rules only, then layers an AI
analysis step that catches what regex detectors miss:

- False-positive identification (e.g. "this dynamic-import is in a
  test fixture and is intentional")
- Exploit-severity vs rule-severity (the rule's severity is the
  general risk; the actual finding may be higher or lower in context)

## Scheduled cadence

Declares `trigger: schedule: { interval: 7d }`. The runtime records
last-run in `substrate/scheduler/state.json`; `substrate scheduler
--check` lists it as due weekly. `substrate scheduler --auto-run`
fires it.

For tighter cadence on hot codebases, switch to `interval: 24h` or
`every-n-commits: 50`.
