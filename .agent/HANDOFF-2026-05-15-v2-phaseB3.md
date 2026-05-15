# Substrate v2 — Phase B3 (Loop closure) Handoff

> **Status:** B3 complete. The headline primitive — the proposal pipeline — ships end-to-end.
> **Branch:** `v2` (8 commits ahead of `main`)
> **Test count:** 573 passed + 1 skipped (started B3 at 446 + 1; +127 new tests across 11 new + 4 modified files)
> **Gates:** build, lint, typecheck, test — all green.
> **Next agent run:** Phase B4 (Polish + release).

B3 is purely additive on top of B1 + B2. v1.0 surface remains untouched.
The proposal pipeline, drift detectors, session-event-log, scheduler,
and applicators all live in new modules; the only cross-layer wiring
is the orchestrator `run-command.ts` emitting session events + passing
the manifest/sessionLogPath to the hook firing context (additive
optional fields on `HookFiringContext`).

---

## Completed in this run

### Commits

| SHA       | Message                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| `4956a00` | feat(v2): proposal pipeline — telemetry + drift detection + queue [substrate-v2-B3]            |
| `b214fd8` | feat(v2): applicators + review walk + scheduler + doctor aggregation [substrate-v2-B3]         |

Two commits, partitioned at a clean sub-phase boundary (the first
covers Components A–C + queue + auto-drift-detect handler swap; the
second covers Components E + F, scheduler runtime, and doctor
aggregation). Per the brief, this was the natural decomposition — A–C
form a self-contained read+write detection cycle; E–F integrate with
the consumer-side UX surface.

### Files changed

**New modules (orchestrator layer):**

- `src/v2/orchestrator/session-log.ts` — Component A. JSONL-per-run
  emitter at `substrate/sessions/<workflow>-<sha>.jsonl`. Eight event
  types matching plan §3.9. Sanitiser strips paths/tokens/emails and
  truncates `description` / `prompt` / `output` to 120 chars.
- `src/v2/orchestrator/drift-detectors.ts` — Component B. Six pure
  detectors: `adhoc-step`, `skipped-step`, `out-of-order`,
  `context-gap`, `repeated-prompt`, `rule-violation-recurrence`.
  Composed via `runDriftDetectors()` (reads current log + history
  index, sorts findings high → medium → low).

**New modules (deterministic layer):**

- `src/v2/deterministic/proposals/types.ts` — Eight typed Proposal
  discriminants per plan §3.9 Component C.
- `src/v2/deterministic/proposals/classifier.ts` — DriftFinding[] →
  Proposal[] mapping. Ad-hoc at high confidence piggy-backs
  `add-to-memory`; context-gap maps to `strengthen-context-load`
  with the right contextKind; rule-violation-recurrence maps to
  `add-to-rule`.
- `src/v2/deterministic/proposals/queue.ts` — Component D file I/O.
  `writePendingFile`, `parsePendingFile`, `listPending`, `listByStatus`,
  `moveProposal`, `updatePendingProposal`, `deferProposal`,
  `queueStats`. Markdown-as-source-of-truth with embedded JSON code
  blocks for lossless round-trip.
- `src/v2/deterministic/proposals/pipeline.ts` — single entry point
  `runProposalPipeline()` that wires detector → classifier → queue.
  Plus `parseSessionLogFilename()` helper.
- `src/v2/deterministic/proposals/applicators.ts` — Component E
  applicators (one per Proposal kind). Workflow + RULES.yaml + context
  strengthening go through the comment-preserving YAML helpers.
  Memory applicator uses B2's storage discovery. ADR applicator
  auto-increments DEC-XXX. Doc-check applicator writes v2-schema-valid
  YAML. Standards-doc + cross-link applicators append deterministic
  drafts with embedded `<!-- substrate-proposal: <id> -->` markers so
  follow-up AI / human edits have an anchor.
- `src/v2/deterministic/proposals/review-command.ts` — `substrate
  review --proposals` walker. Five controls: accept / reject / edit
  / defer / skip. `--dry-run` preserves queue; `--batch-confirm` is
  the headless contract (auto-accept high, defer the rest).
- `src/v2/deterministic/scheduler.ts` — Primitive 8 runtime. In-house
  cron parser (5-field with `*`, ranges, comma-lists, step, named
  days/months). State file at `substrate/scheduler/state.json`.
  `recordWorkflowRun`, `checkSchedule`, `bumpCommitCounter`,
  `clearSchedulerState`, `isScheduled`.
- `src/v2/deterministic/scheduler-command.ts` — `substrate scheduler
  --check` deterministic CLI. Non-invasive: never invokes workflows.
- `src/v2/deterministic/yaml-edit.ts` — comment-preserving YAML
  surgery. `appendListItem`, `insertListItemAfter`, `appendToMapKey`.
  Each operation maps to one applicator's need; the module
  intentionally rejects depth > 2 / unknown shapes so applicator bugs
  surface loudly rather than corrupting YAML silently.

**Templates:**

- `templates/workflows/weekly-proposal-walk.yaml` +
  `templates/workflows/weekly-proposal-walk.body.md` — Component F
  reference workflow. Fires Monday 09:00 UTC; one step that shells
  out to `substrate review --proposals --batch-confirm`.

**Modified (additive only):**

- `src/cli.ts` — wires `substrate review --proposals` (replacing the
  deferred stub) and adds `substrate scheduler --check`.
- `src/commands/doctor.ts` — adds `checkMemoryFrontmatter()` aggregation
  walking the active memory store.
- `src/v2/orchestrator/run-command.ts` — emits session events at
  every lifecycle point; passes `manifest` + `sessionLogPath` + `cwd`
  in the firing context for workflow-completion; stamps scheduler
  state on completion when the workflow is scheduled. Surfaces
  `sessionLogPath` on `RunWorkflowResult`.
- `src/v2/orchestrator/hook-dispatch.ts` — swaps the B2 skeleton
  handler for the real `auto-drift-detect` body that calls
  `runProposalPipeline`.
- `src/v2/hooks.ts` — extends `HookFiringContext` with optional
  `manifest`, `sessionLogPath`, `cwd` (the proposal pipeline reads
  them). Backwards-compatible: existing hooks ignore the new fields.
- `src/v2/deterministic/index.ts` — barrel adds proposal pipeline,
  scheduler, yaml-edit re-exports.
- `src/v2/orchestrator/index.ts` — barrel adds session-log + drift
  detectors + hook dispatch re-exports.
- `templates/hooks/auto-drift-detect.yaml` — description updated to
  reflect that the handler is now real (not skeleton).
- `tests/v2-hooks.test.ts` — B2's `status=deferred` placeholder
  assertion flipped to assert the new defensive `status=skipped` when
  firing context lacks pipeline inputs.
- `tests/v2-run.test.ts` — hook-dispatch test flipped from `deferred`
  to `ok + "no drift detected"` (the clean workflow run path).
- `tests/v2-reference-templates.test.ts` — REFERENCE_IDS adds
  `weekly-proposal-walk`.

**Docs:**

- `docs/scheduling.md` — three invocation paths (CI / local cron /
  AI-session) for `trigger: schedule`, with copy-pasteable snippets.

### New test suites (127 new tests; 11 files)

| File                                  | Tests | Coverage                                                            |
| ------------------------------------- | ----- | ------------------------------------------------------------------- |
| `v2-session-log.test.ts`              | 22    | path resolution, manifest hashing, sanitisation (paths/tokens/emails/truncation), writer (disk + in-memory), reader, index |
| `v2-drift-detectors.test.ts`          | 17    | each detector + cross-session history + recurrence confidence escalation + sort order |
| `v2-proposal-classifier.test.ts`      | 11    | per-drift → per-proposal mapping; ad-hoc piggy-back; context-gap kind inference; ordering |
| `v2-proposal-queue.test.ts`           | 14    | layout, write/parse round-trip, listPending order, move (with/without remaining), defer, update, stats |
| `v2-proposal-pipeline-e2e.test.ts`    | 4     | **plan §7 worked example end-to-end** — 4-recurrence ad-hoc generates high-confidence add-to-workflow-step + add-to-memory; pending file shape matches §7 verbatim; inMemoryOnly skips write; clean run writes nothing |
| `v2-yaml-edit.test.ts`                | 12    | comment preservation across appendListItem / insertListItemAfter / appendToMapKey; inline `[]` expansion; missing-key errors |
| `v2-proposal-applicators.test.ts`     | 14    | each applicator's file shape + dry-run + failure paths (e.g. RULES.yaml missing) |
| `v2-proposal-review.test.ts`          | 11    | all 5 controls; --dry-run preserves queue; --batch-confirm tier behaviour; applicator failure surfaces ok=false |
| `v2-scheduler.test.ts`                | 17    | cron / interval / every-n-commits triggers; state load/save; commit counter; named-day handling; malformed state recovery |
| `v2-doctor-memory.test.ts`            | 5     | ok / warn / no-store / json / example-cap |

### Design decisions taken

1. **Two-commit B3 instead of one or seven.** The brief explicitly
   permits per-sub-phase commits but warns against half-implemented
   commands. The two commits align with the natural API surface: the
   first ships the pipeline that's only useful end-to-end (telemetry +
   detection + classifier + queue + the auto-drift-detect handler swap
   that makes them all run together); the second ships the consumer-
   facing surface (review walker + applicators + scheduler + doctor
   aggregation). Either is shippable independently.

2. **Single-commit C3 = ship the auto-drift-detect handler with the
   pipeline.** The brief asks for "real handler replaces skeleton" as
   an explicit acceptance criterion. We swap the handler in the
   FIRST commit (not the last), because (a) the pipeline isn't
   useful without it firing; (b) leaving the skeleton in place for
   any commit would mean the deferred-behaviour assertions stay
   green misleadingly. The defensive fallback (status=skipped when
   firing context lacks inputs) means the handler still degrades
   cleanly when called from non-orchestrator paths.

3. **In-house cron parser instead of `cron-parser` (npm).** Plan §3.9
   doesn't pin a library; the brief explicitly says to verify
   versions before adding dependencies. Substrate's "no-runtime-deps"
   discipline from B2 (in-house glob matcher) extends here. The cron
   surface we need — 5-field with `*` / ranges / comma-lists / step
   / named days/months — is ~50 LOC and well-tested. Consumers using
   exotic cron (predefined macros like `@hourly`, second-field
   precision, etc.) would need a real library; we'll cross that
   bridge if it comes up. The error path treats unparseable cron as
   "always due" with a warning, so the failure mode is loud, not
   silent.

4. **Telemetry v: 3 NOT bumped; v: 2 unchanged.** B3 doesn't touch
   the telemetry events written to `~/.config/substrate/telemetry.log`
   (that's a separate channel from the session-event-log). The
   session-event-log is a new artefact with its own implicit version
   (the file shape itself). When that file shape changes, we'll
   introduce an explicit `version` field. For B3, every event is
   self-describing via `event` discriminant — no schema header
   needed.

5. **Sanitiser blocklist is conservative.** Better to redact false
   positives than to leak. The full blocklist:
   `/home/<x>`, `/Users/<x>`, `C:\\Users\\<x>`, `Bearer <token>`,
   `sk-<openai-style>`, `ghp_<github>`, generic emails. Tests pin
   each pattern explicitly. Consumer-side discovery of new leakage
   shapes adds to the list.

6. **TEXT_FIELD_MAX_CHARS = 120 chars (plan §3.9 spec).** Applied
   only to `description` / `prompt` / `output` fields. Ids and
   timestamps stay full-length because their identity matters.

7. **Pending-file filename: `<YYYY-MM-DD>-<workflow-id>-<sha>.md`.**
   The plan worked example uses `2026-05-14` + `tackle-task` +
   `abc1234`; we use full 8-char sha for uniqueness across same-day
   runs of the same workflow. A run that produces no proposals writes
   no file (silent success).

8. **Single proposal per file in applied/ and rejected/.** Pending
   files group per-run; applied/rejected split per-proposal because
   the user accepts/rejects one at a time. Filename:
   `<YYYY-MM-DD>-<proposal-id>.md` where proposal-id is the 12-hex
   stableId from the classifier.

9. **Applicators do not call AI.** Plan §5.4 says "the apply step is
   mixed determinism — some applicators need AI for drafting." The
   B3 implementation skirts this: deterministic drafts get written
   with embedded `<!-- substrate-proposal: <id> -->` anchors so a
   follow-up AI step (or the user manually) can finish polishing.
   The applicator's contract is "put the right scaffold in the right
   file"; AI-finishing is a B4 polish item if anyone wants it.

10. **Comment-preserving YAML helpers cap at depth 2.** The
    applicators that need nested edits (e.g. `context.standards`)
    have a 2-level path. Deeper nesting would require a parser-aware
    edit model and isn't needed in B3.

11. **Scheduler state file at `substrate/scheduler/state.json` (not
    `substrate/sessions/`).** Session logs are append-only telemetry;
    scheduler state is small mutable JSON. Different lifecycle →
    different directory. Empty/missing state file is a first-class
    state (returns `{ version: 1, workflows: {} }`).

12. **`substrate scheduler --check` lists, never runs.** Three
    invocation paths in `docs/scheduling.md`; substrate ships the
    discovery + state-tracking primitives; the consumer environment
    wires the invoker (cron, GitHub Actions, AI prompt). Keeping
    invocation out of substrate means we don't ship a long-running
    process.

13. **`substrate review --proposals` requires the `--proposals` flag.**
    Future review verbs (`--pre`, `--deep`, `--standards`) are
    planned. Reserving `--proposals` as a required flag now means
    the surface is forward-compatible without ambiguity.

14. **B2's deferred-behaviour test got the defensive-skipped flip.**
    The brief specifically called this out as a "don't leave stale
    deferred assertions" rule. Now the test asserts that the
    handler returns `status=skipped` with a clear message when
    firing context lacks the pipeline inputs. The path that
    surfaces real drift-detection behaviour is covered by the new
    end-to-end test.

15. **`v2-run.test.ts`'s `hooked` workflow test flipped.** The 1-step
    clean run produces 0 drift findings → 0 proposals → handler
    returns `ok` with `"no drift detected"`. Old assertion (`deferred`)
    flipped to the real one.

---

## Pending / next up

### Phase B4 — Polish + release

Per plan §11 + the brief:

1. **Plural knowledge sources (P11).** docker-compose-plus-others
   support; closes OP4Z Gap 9.
2. **`substrate doctor` v2 enhancements (P10) remainder.**
   `--check rules-doc-coverage`, `--check workflow-coverage`,
   `--check stale-proposals`, `--check escalation-debt`. The memory
   aggregation slice landed in B3 (this run).
3. **`substrate init` v2 enhancements.** Init scaffolds an empty
   substrate/proposals/ + substrate/sessions/ + substrate/scheduler/
   layout. Should also offer to copy `weekly-proposal-walk` into the
   consumer's substrate/workflows/.
4. **Version bump 1.0.0 → 2.0.0.** Per the brief, this is B4 — do
   not bump in B3. The package.json file is untouched.
5. **CHANGELOG.md + migration guide entries for v2.0.**
6. **docs-site v2.0 update** (covers the proposal pipeline +
   scheduling + drift detection from a user perspective).
7. **README v2.0 coverage.**
8. **npm publish prep + actual publish.**

### Possible B4 polish ideas (lower priority)

- **AI-drafted standards-doc + ADR applicators.** Currently they
  write deterministic drafts with embedded anchors. A B4 polish pass
  could surface the draft to an orchestrator step that calls a
  prompt-style applicator. Not blocking — the deterministic drafts
  are usable as-is.
- **`substrate scheduler --check --auto-run`.** Today's CLI is
  non-invasive; a B4 enhancement could let cron-driven invocations
  invoke `substrate run` for every due workflow. Trivial wrapper.
- **Scheduler `--all` flag.** `--due-only` exists; an `--all` flag
  (or its inverse) is the obvious symmetry. Currently the default IS
  `--all` (list everything) and `--due-only` filters.
- **Public extension point for the noop-handler registry.** B2's
  open question — recommend leaving internal until a real plugin
  contract emerges.

---

## Open questions for the user

None blocking. One observation worth flagging:

- **Out-of-order detection's confidence is hard-coded to `medium`.**
  The detector treats any manifest-order inversion as drift-worthy.
  In practice, the user may want different confidence for
  "implement → tests" vs "research → tests" inversions. Today every
  inversion produces one `medium`-confidence proposal that suggests
  documenting the new order in a standards doc. If we want
  per-step-pair confidence, the detector would need a per-pair
  threshold table. Not blocking — defer until users complain.

- **Cross-link applicator uses a regex to spot backticked targets in
  skipped-step descriptions.** This is the heuristic from the
  classifier. False negatives (the user's step prompt referenced a
  doc without backticks) become silent no-ops. False positives
  (backticked-but-not-a-path) write a useless cross-link. The
  proposal layer's medium confidence makes both tolerable;
  applicator-side validation isn't worth the complexity.

---

## Notes for the next agent

### Where the seams to B4 are

- **`package.json` version bump.** Currently 1.0.0. Bump to 2.0.0
  as the FIRST commit of B4 — this is the contract that the rest of
  the v2 surface depends on.

- **CHANGELOG.md.** Living doc at the repo root. B4 should write a
  `## 2.0.0 — <date>` section enumerating B1+B2+B3 deliverables.

- **Migration guide.** `docs/migration-from-0.x.md` exists for the
  pre-1.0 era; B4 adds `docs/migration-from-1.x.md` covering the
  v1 → v2 surface (mainly: new workflows/ layout, proposals/
  layout, hooks/ layout, doc-checks/ layout).

- **README.md.** The package's README lives at
  `packages/substrate/README.md` (also visible at the repo root).
  B4 should refresh both: the README's "Features" / "Quick start"
  sections still talk about v1.0 surface.

- **`substrate init` v2.** Currently scaffolds the v1 layout.
  Should add `substrate/proposals/{pending,applied,rejected}` +
  `substrate/sessions/` + `substrate/scheduler/` directories +
  optionally copy `weekly-proposal-walk` into substrate/workflows/.
  Pattern: edit `src/commands/init.ts`. The `AUTO_SUBDIRS` constant
  in `src/util/paths.ts` is the canonical list; consider whether
  the new dirs go under `substrate/` (where workflows + hooks +
  doc-checks already live) or `auto/` (where audits + standards
  live). Recommended: under `substrate/` to match the other v2
  artefacts.

- **Plural knowledge sources (P11).** Spec is in plan §3.11. New
  module: `src/v2/knowledge/sources.ts` + plugin contract for
  `docker-compose` (B2 already has this, just needs the v2 contract
  layer) / `kubernetes` / `terraform-state` / `env-registry`. Each
  source plugin is a function that returns `KnowledgeBlock[]`. The
  context-loader's `knowledge` resolution becomes real.

### Conventions established (in addition to B1+B2's)

1. **Schema files live at `packages/substrate/schemas/`.** B3 didn't
   add any — the proposal queue's markdown shape is the contract,
   embedded JSON code blocks carry the deserialisable payload.

2. **Pipeline orchestration glue lives in `pipeline.ts`.** The pattern:
   `runProposalPipeline()` accepts a `*Options` interface and returns
   a `*Result` shape. CLI commands import the function + the result
   type; deterministic-layer barrel re-exports them. Mirror this for
   future pipelines.

3. **Per-applicator return shape.** Every applicator returns
   `{ ok, writes, message, warnings? }`. Writes are absolute paths
   with `mode` (`create` / `modify`) + optional `preview`. Walker
   surfaces them uniformly.

4. **Comment-preserving YAML edits are the standard for user-authored
   YAML.** Don't use `parse + stringify` on workflow manifests, hook
   manifests, doc-check manifests, or RULES.yaml. Use the helpers in
   `yaml-edit.ts`. If the helpers don't support the edit you need,
   extend them with a new operation + test fixtures.

5. **Cron parsing is in-house at the 5-field level.** Don't pull in
   `cron-parser` unless the consumer use case demands `@hourly`-style
   predefines. If we do pull it in, the in-house parser stays as a
   fallback (the runtime falls through to "always due" on unsupported
   forms, which is the safe behaviour).

6. **Session-event-log filenames: `<workflow-id>-<8hex>.jsonl`.** The
   8-hex prefix is a sha256 truncation of `id|startTime|salt`. The
   `parseSessionLogFilename` helper extracts the workflow id + sha
   from the path; both consumers use it.

7. **Proposal id is a 12-hex truncation of `sha256(kind|workflowId|
   driftSignature)`.** Stable across runs — same drift → same
   proposal id → de-duplicates in the queue.

### Gotchas

1. **`*/` inside JSDoc breaks TypeScript parsing.** When documenting
   cron syntax in code comments, avoid the literal `*/N` form (use
   "slash-N" or "step" instead). This bit me in `scheduler.ts`.

2. **`process.env.SUBSTRATE_MEMORY_PATH` leaks between tests.**
   B2 documented this; B3's doctor tests follow the pattern.

3. **`runV2Workflow` now ALWAYS writes a session-event-log file on
   non-dry-run paths.** Cost is one `mkdirSync` + per-event
   `appendFileSync`. Negligible. dry-run uses the in-memory writer.

4. **`auto-drift-detect` handler runs IN-PROCESS.** It shares the
   already-parsed manifest + session log path via the firing
   context's optional `manifest` / `sessionLogPath` / `cwd` fields.
   That's the seam the brief flagged; B3's defensive `status=skipped`
   fallback covers the case where the hook fires from outside the
   orchestrator path.

5. **The applicator + walker UX is intentionally minimal.** No
   inquirer prompts here — the brief mentions diff previews. The
   `WalkProposalsOptions.decisions` array is the programmatic
   contract; the CLI layer wires an interactive prompt only when
   neither `--batch-confirm` nor pre-supplied decisions are given.
   Today the default is "skip" (re-surface next walk) — a B4 polish
   pass adds the inquirer-driven prompt loop.

6. **Pending file rewrite via `moveProposal` runs `parsePendingFile`
   on the current state.** If the file has been edited between the
   walker's read and the move, the rewrite uses the parsed-fresh
   list. Race is benign in single-user contexts; in CI-driven
   multi-walker contexts (which we don't expect) lock files would
   be needed.

7. **Scheduler `recordWorkflowRun` doesn't update commit counters
   for OTHER scheduled workflows.** If workflow A runs, A's
   commit counter resets; B's does not. `bumpCommitCounter` (called
   from a post-commit hook) is the only thing that increments
   counters globally.

### Don't do these

1. **Don't bump `package.json` to 2.0.0.** Per hard rule #2. The
   version stays at 1.0.0 through B3; B4 bumps it before publish.

2. **Don't push to GitHub or npm publish.** Per hard rules #3/#4.

3. **Don't change v1.0 surface non-additively.** B3 added optional
   fields to `HookFiringContext` (`manifest`, `sessionLogPath`,
   `cwd`) and `RunWorkflowResult` (`sessionLogPath`). All optional;
   pre-B3 callers see the same shape.

4. **Don't reach for `cron-parser` (or any new dep) without a
   concrete need.** The B2/B3 no-runtime-deps story is real; the
   only new code in B3 that's library-shaped (cron parsing) is
   ~50 LOC and well-tested. Adding a 100KB dep for cron predefines
   is a bad trade.

5. **Don't break the comment-preserving YAML contract.** If a B4
   applicator needs a new edit shape, add an operation to
   `yaml-edit.ts` with fixture-based tests, not a one-off
   `parse + stringify` call.

6. **Don't move applicators to the orchestrator layer.** They're
   deterministic by design. The AI-drafted polish (B4 idea above)
   would be a new orchestrator-layer wrapper that CALLS the
   deterministic applicator after drafting.

---

## Versions installed (forensic record)

No new dependencies added in B3. All versions unchanged from B1+B2:

```
ajv@8.20.0
ajv-formats@3.0.1
yaml@2.9.0
commander@12.1.0
kleur@4.1.5
zod@4.4.3
@inquirer/prompts@7.0.0
```

`package.json` is unchanged.

---

## Acceptance criteria status

Scored against B3 exit conditions from the brief.

| Criterion                                                                                                                | Status   |
| ------------------------------------------------------------------------------------------------------------------------ | -------- |
| Session-event-log written for every `substrate run` invocation                                                           | **met**  |
| 6+ drift detectors implemented (matching the table)                                                                      | **met** (6) |
| 8 proposal types supported with applicators                                                                              | **met** (8) |
| `substrate query sessions` deterministic query works                                                                     | **partial** — `indexSessionLogs()` ships as the programmatic primitive; a `substrate query sessions` CLI sub-command would be a B4 polish slice (~30 LOC). The pipeline + drift detectors both consume the index today; the CLI is the only missing surface. |
| `substrate review --proposals` walks pending queue with all 5 controls                                                   | **met**  |
| `--dry-run` and `--batch-confirm` flags work on `substrate review --proposals`                                           | **met**  |
| Applicators write correct files (manifest YAML edits preserve comments; memory writes use B2's storage discovery; etc.) | **met**  |
| Applied proposals move to `proposals/applied/`; rejected to `proposals/rejected/`                                        | **met**  |
| `trigger: schedule` schema + runtime working                                                                             | **met**  |
| `weekly-proposal-walk` reference workflow ships                                                                          | **met**  |
| `auto-drift-detect` hook replaced with real handler                                                                      | **met**  |
| Telemetry forbidden-fields rule tested                                                                                   | **met** (path/token/email patterns covered) |
| `substrate doctor` memory-frontmatter aggregation working with `--json`                                                  | **met**  |
| Plan §7 worked example implementable end-to-end                                                                          | **met** (`v2-proposal-pipeline-e2e.test.ts` simulates the full scenario; pending file content matches §7) |
| All gates green                                                                                                          | **met**  |

### `substrate query sessions` — clarification on partial

The brief flags this as a deterministic query. The primitive ships:
`indexSessionLogs({ cwd, workflowId })` returns `[{ path, workflowId,
mtimeMs }]`. `readSessionLog(path)` returns the parsed events.

What's missing: a `substrate query sessions --workflow <id> --limit
<N> [--json]` CLI sub-command that wraps those two and prints them.
Equivalent to ~30 LOC added under `src/v2/deterministic/query-command.ts`.

Rationale for marking partial vs deferring entirely: the proposal
pipeline relies on `indexSessionLogs` to read prior runs for
cross-session detection. That code path IS exercised by the e2e
test (3 prior + 1 current run). So the deterministic surface is
proven; only the human-facing CLI wrapper is absent. Easy B4 polish.

---

**Phase B3 complete. The headline primitive — the proposal pipeline —
ships end-to-end. Ready to begin Phase B4 (Polish + release) in the
next agent run.**

---

*End of HANDOFF. Tag in the parent agent for review and the next run.*
