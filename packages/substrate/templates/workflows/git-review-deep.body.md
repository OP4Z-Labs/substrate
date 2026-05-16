# Deep review — thorough pre-merge walk

The "this PR is non-trivial" review. Composes the fast gate
(`git-review-pre`) with a whole-repo audit + full doctor pass + AI
meta-review. Use when:

- the change touches critical paths (auth, billing, message bus,
  cross-service contracts)
- the diff is over ~200 LOC
- multiple services are affected
- the user asks for it explicitly

## Composition pattern

This workflow demonstrates `invoke-sub-workflow` step composition.
`run-fast-gate` recursively invokes `git-review-pre` — the sub-workflow
gets its own session log, and the parent treats the child's success /
failure as a single step outcome. The recursive runtime caps depth at
5 so workflows that accidentally invoke themselves get a clear error.

## Meta-review

The `meta-review` step uses `prompt-and-action`. Beyond emitting the
prompt + capturing the AI's response, the step engine emits a
`step-confirm` event because the AI is expected to propose
working-tree mutations. The audit trail records the confirmation
regardless of `must-confirm` being set on this specific step (the
engine forces it for tree-mutating action types).

## Resolve findings loop

The `resolve-findings` step is a `prompt` with `must-confirm: true` —
the human gates the loop. The AI walks each viable finding, applies a
fix (or records a deferral rationale), re-runs the affected tests,
and only proceeds when the human confirms the loop is done.

## When to skip

For doc-only PRs, run `git-review-pre` instead — the deep walk is
overkill. For "I have one tiny fix to ship", neither workflow is
required; `substrate run commit-and-push` alone is fine.
