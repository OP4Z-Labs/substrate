# Commit and push

The "ship it" workflow that closes the task-tackle loop. Designed to
be invoked at the end of `tackle-task` (or directly after
`git-review-pre` / `git-review-deep` clears).

## Steps

1. **`pre-commit-audit`** — `substrate audit --diff --json` against
   the staged set. Fast; identical to what `git-review-pre` runs.
2. **`doc-check-eval`** — evaluates the conditional doc-check
   registry. If the diff touches code matching `migration-guide` /
   `adr-on-architecture-change` / `public-docs-on-marketing-change`
   patterns, the eval surfaces the missing doc.
3. **`discover-context`** — a `discover` step that re-loads context
   mid-workflow so the AI's commit-message authoring sees the latest
   memories + standards (especially `feedback-commit-*` patterns from
   prior commits).
4. **`draft-commit-message`** — `prompt` with `must-confirm: true`.
   The AI proposes the conventional-commit message; the human reads
   it and confirms.
5. **`gate-msg`** — explicit gate with `must-confirm: true`. Last
   chance to abort.
6. **`commit`** — `invoke-deterministic`. The reference template
   ships a `true` no-op; replace with `git commit -m "$MESSAGE"`
   wired to your shell. (Left no-op so `substrate run commit-and-push`
   is idempotent in the reference set.)
7. **`push`** — same shape; ships no-op.

## Customisation

Most consumers will want to:

- Replace the `commit` step's `run` with their actual git command
  (often shelling out to a script that takes the message via env var
  or temp file)
- Replace the `push` step similarly
- Add a `--no-verify` policy memory if your team allows / disallows
  it

The reference template stays minimal so it composes without surprise.

## Why a `discover` step

Commit-message conventions tend to drift across feedback memories.
The `discover` step re-loads context mid-workflow so the AI sees the
most recent `feedback-commit-*` patterns even if the workflow started
hours ago and accumulated memories in between.
