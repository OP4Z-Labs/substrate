# Update a standards doc + propose RULES updates + draft ADR

The "we learned something" workflow. Use when a code review surfaces
a recurring issue that should be codified in standards (and optionally
in RULES.yaml as a new detector).

## What makes this useful

Three pieces of work that usually happen separately, composed into
one walk:

1. **Doc update** — staged through the standard proposal queue (not
   written directly). The `propose-doc-change` step writes a pending
   proposal that the user reviews via `substrate review --proposals`.
2. **RULES update** — if the new convention should be enforced
   automatically, a `add-to-rule` proposal accompanies the doc
   change.
3. **ADR** — for architecturally-meaningful changes, an ADR records
   the reasoning. The AI decides whether one is warranted via the
   `maybe-draft-adr` step.

## Demonstrates: propose-doc-change step type

This is one of two workflows in the reference set that uses
`propose-doc-change` (the other being `tackle-task`'s related
implicit pattern). The step's `description` field carries the target
doc path; the `prompt` field carries the addition body. The
applicator pipeline picks it up at the next `substrate review
--proposals` walk.

## The proposal queue gate

`gate-doc` is a `must-confirm: true` gate — the user must look at the
staged proposal in `substrate/proposals/pending/` before the workflow
proceeds. Without this gate, the AI's proposal could ship blind.
