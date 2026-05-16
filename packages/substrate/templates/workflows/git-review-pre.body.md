# Pre-merge review — fast gate

The "is this PR ready to merge" check. Designed to finish in under
30 seconds on a normal-sized PR so it can run as the actual merge gate
without slowing the human in the loop.

## What it does

1. **Diff-only audit.** Runs `substrate audit --diff --json` which
   restricts every ripgrep detector to the staged-diff file set. Script
   + composite detectors still run against the whole repo (they're
   tree-wide by design) but they're typically cheap.

2. **Doctor for diff-relevant checks.** `rules-doc-coverage` +
   `workflow-coverage` + `memory-frontmatter` are the three doctor
   checks that cost essentially nothing to run and surface drift the
   audit detector pass misses (e.g. a new rule was added but the doc
   link is broken).

3. **AI summary.** A single-prompt step (no must-confirm) folds the
   audit + doctor results into a one-paragraph verdict the human can
   read in 10 seconds. Critical findings are called out explicitly.

4. **Gate.** Deterministic acceptance check: every required-step must
   have completed `ok`. If anything failed, the gate fails and the
   workflow exits non-zero — the merge is blocked.

## Composition

The workflow declares `composes_findings_of` for `audit-service` and
`audit-package` with `require-fresh-within: 24h`. If either of those
audits hasn't been re-run in the last 24 hours, the orchestrator
warns at workflow start. The diff-only audit isn't a replacement for
those — it sees only what's in the diff — so when they're stale, the
verdict is incomplete.

## When to skip the gate

If the diff is a doc-only change (no code touched), `substrate audit
--diff` returns zero findings and this workflow is effectively a no-op
gated check. That's the right behaviour — doc-only PRs shouldn't be
gated on the code-quality audit pass.

For deeper review including coverage analysis and security scans, run
`substrate run git-review-deep` (which composes this workflow + adds
several more layers).
