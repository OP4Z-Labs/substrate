# Tackle a task end-to-end

The headline workflow. Walks one task from research to commit
approval in eight reinforced steps. The manifest (`tackle-task.yaml`)
declares context — every standards doc, every rule, the memories
tagged `task-tackle`. The body below is the prose program the AI
session follows.

In B1, the `service-validation` step (docker rebuild) runs
deterministically; every other step is AI-orchestrated and surfaces
`deferred` until B2 ships the prompt-step engine.

---

## Step 1 — Research

Read the task description carefully. Pull every linked ticket and
prior conversation. Cross-reference with the standards loaded into
context (`backend/architecture.md`, `frontend/react.md`, etc.) and
the memories tagged `task-tackle` to find prior conclusions the team
has already reached about this code area.

Surface:

- Affected files (best guess from the task scope).
- Standards that apply.
- Memories that warn against an obvious path ("we tried that in
  OP-432; here's why it didn't work").
- Open questions for the user.

**Confirm** the research summary before proceeding.

## Step 2 — Validate scope

State the scope in one paragraph. List acceptance criteria as a
bulleted checklist. Wait for explicit user confirmation before
writing any code. Don't skip this step — the cost of being wrong
about scope compounds in steps 3-7.

Reference memory: `feedback-task-workflow-standard` documents the
team's preferred task pattern. Read it before proposing the scope.

## Step 3 — Implement

Make the code changes. Prefer editing existing files; resist adding
new modules unless the task explicitly calls for one. Avoid
gold-plating — the scope from step 2 is the contract.

When implementing:

- Match existing patterns. The codebase has conventions; surface them
  from the loaded standards rather than inventing new ones.
- Comment intent, not mechanics. The `why` outlives the `how`.
- Run formatters locally as you go (the pre-commit hook will format,
  but lint errors at commit-time waste reviewer cycles).

## Step 4 — Service validation

Rebuild and restart the docker services affected by the change.
Tail logs for a clean startup. **Do not skip this step on backend
changes** — a service that doesn't boot defeats every downstream
verification.

The `invoke-deterministic` step in the manifest is a placeholder.
Replace the `run:` field with the docker compose invocation matching
your stack:

```bash
docker compose up -d --build <affected-services> \
  && docker compose logs --tail=80 <affected-services>
```

In B1 the placeholder echoes a reminder; in production setups,
configure it once per repo.

## Step 5 — Tests

Invoke the `run-tests-scoped` sub-workflow. Scope tests to the
affected services / packages — full suite runs are too slow to be
the default. The sub-workflow gates on test pass/fail.

If a test fails:

- Read the failure carefully. Don't chase deprecation warnings;
  focus on assertion failures.
- For frontend: ensure `node_modules` exists in the worktree
  (vitest crashes with rolldown parse errors otherwise; memory:
  `feedback-npm-install-after-worktree`).
- For backend: use per-package Poetry envs (`cd <pkg> && poetry
  run pytest`), not Docker (memory: `feedback-run-tests-locally`).

## Step 6 — Deep review

Invoke the `git-review-deep` sub-workflow. The deep review walks the
diff against the loaded standards + rules + memories, produces a
scored findings list, and gates on critical violations.

Required when the diff touches: provider state, backend config,
service-layer status transitions, multiple services, > 200 LOC, or
any critical path (auth, billing, uploads, message bus).

## Step 7 — Resolve findings

Walk every viable finding from the deep review. For each:

- **Fix** — make the change. Re-run affected tests.
- **Defer** — write an explicit rationale. Surface to the user in the
  step-8 diff summary.

Loop until no viable findings remain. "Viable" means the finding is
actionable in this PR's scope; don't widen scope to chase tangential
findings — that's a separate task (`substrate run tackle-task` with
the new scope).

## Step 8 — Await commit approval

Present a one-paragraph summary of the staged diff:

- Files changed (counts).
- Highest-severity finding (if any deferred).
- Key tests added.
- Acceptance-criteria check from step 2.

**Wait for explicit user approval** before invoking the commit
workflow. The user is the gate; not the AI, not the test suite.

After approval, the `followups:` block suggests
`substrate run commit-and-push` — the commit workflow stages, runs
pre-commit hooks, commits with the `[OP-N]` tag, and pushes.

---

## Notes for the workflow author

- The `required-steps:` list in `acceptance:` is the minimum bar.
  Don't override it — every step exists because it caught a class of
  regression in prior runs.
- The `composes_findings_of` field (B2) lets `tackle-task` ingest
  the freshest audit results without re-running the audit. Add it
  when the workflow is paired with audit-service / audit-package.
- Memory `tags: [task-tackle]` is the convention for memories
  surfaced in this flow. Tag your own feedback-* memories
  accordingly so they load deterministically.
