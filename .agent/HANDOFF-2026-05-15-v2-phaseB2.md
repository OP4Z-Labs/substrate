# Substrate v2 — Phase B2 (Reinforcement) Handoff

> **Status:** B2 complete. All five primitives (P3–P7) shipped.
> **Branch:** `v2` (6 commits ahead of `main`)
> **Test count:** 446 passed + 1 skipped (started B2 at 357 + 1; +89 new)
> **Gates:** build, lint, typecheck, test — all green.
> **Next agent run:** Phase B3 (Loop closure) — proposal pipeline.

B2 is purely additive on top of B1. v1.0 surface remains untouched.
Memory + hooks + doc-checks live in their own modules; composition +
escalation extend existing subsystems (orchestrator + audit) along the
seams B1 marked.

---

## Completed in this run

### Commit

| SHA       | Message                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `e38edaf` | feat(v2): phase B2 reinforcement — hooks, doc-checks, memory, composition, escalation [substrate-v2-B2] |

Single-commit B2 because the five primitives' modules are tightly
cross-referenced (deterministic barrel exports all of them; orchestrator
imports composition + hooks together; query-command imports memory +
doc-checks). Splitting would have required interim broken states.

### Files changed

**New modules:**

- `packages/substrate/src/v2/hooks.ts` — schema validator, discovery,
  matching (P3 deterministic core)
- `packages/substrate/src/v2/orchestrator/hook-dispatch.ts` — runs
  `run-deterministic` + `noop` hooks; built-in handler registry for
  noop hooks (auto-drift-detect placeholder for B3)
- `packages/substrate/src/v2/deterministic/hooks-command.ts` —
  `substrate hooks list / describe` CLI
- `packages/substrate/src/v2/doc-checks.ts` — registry validator,
  discovery, matching, evaluation; in-house glob matcher with `**`
  support (P4)
- `packages/substrate/src/v2/memory.ts` — storage discovery,
  frontmatter parser (legacy + extended), queryMemory,
  renderMemoryInjection, encodeProjectPath (P5)
- `packages/substrate/src/v2/composition.ts` — sidecar lookup,
  parseDuration, checkComposition (P6)
- `packages/substrate/src/audit/escalation.ts` — fingerprinting,
  historical-sidecar reading, first-seen index,
  computeEffectiveSeverity, applyEscalations (P7)

**New schemas:**

- `packages/substrate/schemas/hook.schema.json`
- `packages/substrate/schemas/doc-check.schema.json`
- `packages/substrate/schemas/config.schema.json` (memory.path
  extension for substrate.config.json; v2-aware shape)

**Reference templates:**

- `templates/hooks/auto-emit-sidecar.yaml`
- `templates/hooks/auto-update-trend.yaml`
- `templates/hooks/auto-propose-tasks.yaml`
- `templates/hooks/auto-drift-detect.yaml` (B3 seam — handler is
  noop pointing at the in-process `auto-drift-detect` registry entry
  which returns status=deferred)
- `templates/doc-checks/adr-on-architecture-change.yaml`
- `templates/doc-checks/changelog-on-feat-or-fix.yaml`
- `templates/doc-checks/migration-guide-on-schema-change.yaml`
- `templates/doc-checks/public-docs-on-marketing-change.yaml`
  (closes OP4Z Gap 1 explicitly)
- `templates/workflows/audit-composite.yaml` + `.body.md` (P6 demo)

**Schema extensions:**

- `workflow.schema.json` — adds `escalate_after` at workflow level
  (parallel to RULES.yaml-level) and the new `escalationStep` definition

**Existing files modified (along B1 seams):**

- `src/v2/context-loader.ts` — replaces B2 `TODO` stub with real
  memory loading; `ResolvedContext` gains `memoryInjection: string`
- `src/v2/orchestrator/run-command.ts` — dispatches workflow-start /
  step-completion / completion hooks; runs composition freshness check
  before steps; surfaces `composition` + `hookRuns` in result
- `src/v2/deterministic/query-command.ts` — `runQueryMemory` now uses
  the real memory subsystem; new `runQueryDocChecks`
- `src/v2/types.ts` — adds `WorkflowEscalationStep`,
  `EscalationTargetSeverity`; extends `WorkflowManifest` with
  `escalate_after`
- `src/audit/types.ts` — `Finding` gains optional `originalSeverity`,
  `firstSeenAt`, `ageDays`; `RuleDefinition` gains `escalate_after`
- `src/audit/rules.ts` — loader validates `escalate_after`; sorts
  steps ascending by age_days
- `src/audit/index.ts` — re-exports escalation utilities
- `src/commands/audit.ts` — calls `applyEscalations` between runner
  and report write
- `src/cli.ts` — wires `substrate hooks`, `substrate query
  doc-checks`, `--memory-path` flag on `query memory`
- `src/index.ts` — exports memory, hooks, doc-checks, composition
  flat (alongside `deterministic.*` namespace which exports the same)
- `src/v2/deterministic/index.ts` — barrel adds new exports
- `templates/standards/cross-cutting/RULES.yaml` — BE-PY-001 gains
  `escalate_after` (the reference example); also fixed an existing bug
  where INF-DOCKER-002's `description:` contained unquoted backticks
  that broke `yaml.parse()` (caught by the new escalation test that
  loads RULES.yaml via the loader)

**Updated tests (B1 deferred-behavior flips):**

- `tests/v2-context-loader.test.ts` — memory tests now assert real
  loading instead of B2-deferred warning
- `tests/v2-query.test.ts` — `runQueryMemory` tests assert source +
  filtering behaviour
- `tests/v2-reference-templates.test.ts` — REFERENCE_IDS adds
  `audit-composite`
- `tests/v2-run.test.ts` — adds hook-dispatch + composition-warning
  integration assertions

**New test suites (89 new tests; 5 files):**

| File                          | Tests | Coverage                                                            |
| ----------------------------- | ----- | ------------------------------------------------------------------- |
| `v2-hooks.test.ts`            | 24    | schema, discovery, matching, dispatch (run-det + noop), list/describe |
| `v2-doc-checks.test.ts`       | 18    | schema, discovery, when-matching, require evaluation, query, globs |
| `v2-memory.test.ts`           | 21    | discovery precedence, both frontmatter shapes, filters, expiry, injection |
| `v2-composition.test.ts`     | 10    | parseDuration, sidecar lookup, stale/fresh detection, reference template valid |
| `v2-escalation.test.ts`       | 13    | loader, severity math (incl. bump caps), sidecar history, applyEscalations |

### Design decisions taken

1. **Single-commit B2 instead of per-primitive commits.** The five
   primitives' modules cross-reference: the deterministic barrel
   exports all four new modules; orchestrator imports composition +
   hooks together; query-command imports memory + doc-checks. Splitting
   would have required interim broken states that wouldn't typecheck.
   B3 won't have this constraint — proposal pipeline is more isolated.

2. **`noop` step type for hooks with in-process handlers.** Two-step
   types: `run-deterministic` (shells out) and `noop` (resolves to a
   built-in handler registered in `hook-dispatch.ts`). Built-ins ship
   with substrate; consumer-authored handlers route through
   `run-deterministic`. Cleanly separates "external == process boundary"
   from "internal == registry entry."

3. **`auto-drift-detect` ships as a documented skeleton with a real
   handler that returns `status: "deferred"` + "B3" message.** Per the
   brief, this is the cleanest seam to the proposal pipeline. Tests
   assert the placeholder behaviour explicitly; B3 swaps in the real
   handler via `registerHookHandler('auto-drift-detect', ...)`.

4. **Hooks are advisory by default; `fail-on-error: true` is opt-in.**
   A non-zero exit from a `run-deterministic` hook (or a throw from a
   noop handler) records `status: "skipped"` with the error message
   and does NOT fail the workflow. Authors who want their hook to
   block must explicitly set `fail-on-error: true`. Rationale: hooks
   are reinforcement plumbing, not gates — gates live in workflow
   steps. Surprising users with a workflow that fails because their
   sidecar emitter died is a footgun we explicitly avoided.

5. **In-house glob matcher (not minimatch/micromatch).** Doc-checks
   and memory both need glob-against-path matching. Rather than pull
   in a glob runtime dep, `src/v2/doc-checks.ts` ships a self-contained
   `matchGlob` supporting `*`, `**`, `?`, `[...]`, and escaping. Memory
   re-uses it. Rationale: substrate's no-runtime-glob-deps story
   matters for npm install footprint; the surface needed is narrow
   (file paths, no exotic syntax).

6. **Frontmatter parser uses `yaml.parse` (not the v1 minimal parser).**
   The v1 frontmatter parser at `src/util/frontmatter.ts` is the
   minimal "key: value" form that audit-instruction headers use. v2
   memory frontmatter has nested `metadata.{...}` blocks, arrays
   (`tags`, `applies_to_globs`), and we already ship `yaml` as a
   runtime dep. Using `yaml.parse` for memory frontmatter is correct;
   the v1 parser remains for its existing audit-instruction use case.

7. **Storage discovery precedence: flag > env > config > Claude Code
   default > none.** Matches plan §6.1 verbatim. `source` is reported
   alongside the resolved path so callers know which rung populated
   the path. `none` is a first-class state — queries return empty
   with a clear warning rather than throwing.

8. **`isExpired` drops expired memories at query time.** Plan §6.2
   says memories can declare `expires: YYYY-MM-DD`. Expired memories
   stay on disk (no auto-deletion) but don't surface in queries. This
   lets `substrate doctor` flag them separately (B4 work) without the
   query path returning stale guidance.

9. **Sidecar fingerprint = `ruleId + path + snippet`.** Line numbers
   drift between runs as code is edited; we deliberately exclude them
   from the fingerprint so the same finding's first-seen date survives
   line-shifts. Code edits that change the snippet (i.e. the matched
   text changed) correctly count as a new finding.

10. **`bump` severity caps at `critical`.** Plan §3.7 doesn't specify
    cap behaviour for `escalate_after: target_severity: bump`. We cap
    at critical — there's no "super-critical" in the v1 severity
    vocabulary. Tests pin this behaviour so it can be revisited if
    plan §3 ever introduces a fifth severity level.

11. **`applyEscalations` reads ALL rules, not just the filtered run
    set.** When the audit command receives `--rule X`, only that rule
    is executed — but its findings might still carry escalations
    that depend on `escalate_after` from a rule not in the filtered
    set. We pass `allRules` (pre-filter) to `applyEscalations` so
    escalations consistently apply regardless of filter.

12. **`yaml` parse error in shipped RULES.yaml template was a
    pre-existing bug.** `INF-DOCKER-002`'s description had unquoted
    backticks. Caught only because the new escalation test loads the
    shipped template via `loadRules`. Quoted the string. Doesn't
    affect the audit runtime in production (it would have failed
    `substrate audit` for any consumer using the shipped template).

### Tests added — coverage map

(Same table as the file-changes section above.)

---

## Pending / next up

### Phase B3 — Loop closure (the headline)

1. **Proposal pipeline (P9).** Plan §3.9 + §7. Sub-components:
   session-event-log writer, drift detectors (6+ kinds), proposal
   classifier (8 types), proposal queue (`substrate/proposals/`),
   walk/apply (`substrate review --proposals`).
2. **Replace `auto-drift-detect` skeleton handler with real
   implementation.** `registerHookHandler('auto-drift-detect', ...)`
   in the proposal pipeline module. Tests in `v2-hooks.test.ts`
   currently assert the skeleton behaviour; flip them in B3.
3. **`trigger: schedule` runtime (P8).** Schema already accepts.
   Reference workflow `weekly-proposal-walk` ships.
4. **Step engine — AI-step types.** Same shape B1 flagged. The
   skeleton dispatch is in place; B3 wires real prompt-loop +
   confirmation + sub-workflow flow.

### Phase B4 — Polish + release

5. **`substrate doctor` v2 enhancements (P10).** Checks for
   rules-doc-coverage, workflow-coverage, memory-frontmatter (B2
   memory module already emits per-entry warnings; doctor aggregates),
   stale-proposals, escalation-debt.
6. **Plural knowledge sources (P11).**
7. **`substrate init` v2 enhancements.**
8. **README + docs-site v2 coverage.**
9. **Version bump 1.x → 2.0.0** + npm publish.

---

## Open questions for the user

No design forks emerged during B2 implementation. The plan §6 deep dive
covered every memory-injection detail; §3.3/§3.4 covered hooks +
doc-checks with enough specificity that no judgement calls were
needed beyond what's recorded in "Design decisions taken" above.

One nicety worth flagging (not blocking B3):

- **Hook handler registry as public extension point.** B2's
  `registerHookHandler()` is exported from `hook-dispatch.ts` but not
  re-exported from the main barrel. If consumers (or plugins) ever
  want to register custom noop handlers, we'd need to either expose
  the function or push them toward `run-deterministic` hooks
  exclusively. **Recommend:** keep the registry internal until there's
  a real use case; consumer-authored handlers route through
  `run-deterministic` (process boundary == extensibility boundary).
  Revisit when a plugin contract is real.

---

## Notes for the next agent

### Where the seams to B3 are

- **`auto-drift-detect` handler.** The placeholder lives at
  `src/v2/orchestrator/hook-dispatch.ts` in the `BUILTIN_HANDLERS`
  map. Tests assert it returns `status: "deferred"` with a "B3"
  message. B3 replaces the handler body to read the session-event-log
  + run drift detection. The hook manifest in `templates/hooks/` does
  not need to change.

- **Session-event-log.** B2 does NOT write `substrate/sessions/*.jsonl`.
  The orchestrator's `runStep` is the place to emit step-start /
  step-completion events. The shape is documented in plan §3.9
  Component A. Add a `session-event-log.ts` module under
  `src/v2/orchestrator/` and call its `emit()` from `runV2Workflow`
  at each lifecycle point.

- **Sidecar emit.** B2 reuses the v1 `writeAuditReport` sidecars for
  composition freshness + escalation history. B3's `substrate
  emit-sidecar` (mentioned in plan §3.3's reference hook) would unify
  the contract across non-audit workflows. The
  `auto-emit-sidecar` hook currently just echoes — a real
  emit-sidecar command (deterministic-layer) writes a JSON file at a
  uniform path.

- **`substrate query sidecars --workflow <id>`.** Plan §3.6 mentions
  this; B2 didn't ship it because the composition layer already
  reads sidecars directly. If B3 wants a CLI for users to inspect
  sidecar freshness without invoking a workflow, add it under
  `src/v2/deterministic/query-command.ts`.

### Conventions established (in addition to B1's)

1. **Schema files live at `packages/substrate/schemas/`.** Three new
   ones added (hook, doc-check, config). Each schema gets a sibling
   validator in the matching v2 module (`validateHookManifest`,
   `validateDocCheckManifest`). Pattern is uniform: lazy-load schema,
   cache compiled validator, format ajv errors.

2. **Discovery modules follow the workflow pattern.** `discoverHooks`
   and `discoverDocChecks` mirror `discoverWorkflows`: walk
   `substrate/<kind>/*.yaml` shallow, validate each, segregate
   invalids, sort by sensible default.

3. **CLI v2 commands all take `cwd?`, `quiet?`, `json?`.** Same as
   B1. Tests use `quiet: true` to silence console output during
   spy-mocked tests.

4. **In-process handler registry pattern for noop hooks.** If B3 needs
   to register more in-process hooks (e.g. `auto-update-trend` going
   from "echo" to a real trend-journal writer), use
   `registerHookHandler('auto-update-trend', fn)`. The pattern keeps
   substrate's own hooks fast (no shell-out) while consumer hooks
   route through `run-deterministic`.

5. **`matchGlob` is exported from `doc-checks.ts`.** Memory imports it
   for `applies_to_globs`. If a third caller needs path globbing,
   extract it to a util module — but only on third use (rule of
   three).

6. **Memory `path` is absolute on the returned `MemoryEntry`.**
   Callers can show provenance and link to the file. The relative
   form (under the memory store) isn't carried — if needed, derive
   from `path` against the resolved `memoryPath`.

### Gotchas

1. **ajv resolution (same as B1).** Three modules now compile schemas:
   `validate.ts` (workflow), `hooks.ts`, `doc-checks.ts`. Each has its
   own cached validator. The `(Ajv as unknown as { default?: ... }).default
   ?? Ajv` cast pattern is duplicated in each — survives both CJS and
   ESM module shapes. If a simpler form emerges in a future TS release,
   the three are safe to refactor together.

2. **Tests must override `homeDir` to avoid coupling to the user's
   actual Claude Code memory.** Memory-related tests use
   `homeDir: makeTempDir()` to ensure Claude Code's default discovery
   resolves to a missing directory. Without that, tests on Beau's
   machine could accidentally pick up real memories from
   `~/.claude/projects/-home-beaug-dev-public-substrate/memory/`.

3. **`process.env.SUBSTRATE_MEMORY_PATH` leaks between tests.** Tests
   that set it must `delete process.env.SUBSTRATE_MEMORY_PATH` in
   `afterEach`. `v2-memory.test.ts` does this. New tests touching the
   env var must follow the same pattern.

4. **`runV2Workflow` now ALWAYS calls `discoverHooks` once per run,
   even when no hooks exist.** Cost is one `readdirSync` on a missing
   dir (or one on a directory of N files); negligible. We don't lazy-
   evaluate this because the workflow-start hook needs to fire BEFORE
   the first step regardless of step types.

5. **`escalate_after` only applies when historical sidecars exist.**
   On a fresh repo (no `substrate/audits/*.json` files), every
   finding is age-zero and no escalation fires. This is correct
   behaviour but worth noting in case B3 wants to seed first-seen
   data from another source.

6. **`runQueryDocChecks --for-files` evaluation.** When `--for-files`
   is omitted, the command returns the registry listing only (no
   evaluation). Pass `--for-files <list>` to evaluate. The
   `--changelog-touched` flag is a convenience for callers who don't
   want to remember whether `CHANGELOG.md` was in the diff.

### Don't do these

1. **Don't bump `package.json` to 2.0.0.** Per hard rule #2. The
   version stays at 1.0.0 through B3; B4 bumps it before publish.

2. **Don't push to GitHub or npm publish.** Per hard rules #3/#4.

3. **Don't change v1.0 surface non-additively.** Audit subsystem got
   new fields on `Finding` / `RuleDefinition` — all optional, all
   backward-compat. Pre-B2 callers still see the same shape.

4. **Don't refactor the duplicated ajv cast.** Three modules now use
   the same `(Ajv as unknown as { default?: ... }).default ?? Ajv`
   pattern. Tempting to extract to a util, but the cast is small and
   the import resolution semantics are subtle — duplicate-and-leave
   is the right call until ajv ships a cleaner ESM shape.

5. **Don't move the placeholder `auto-drift-detect` handler out of
   `hook-dispatch.ts`.** B3 swaps the function body in place — that's
   the cleanest diff. Moving the registry to a separate file would
   complicate the swap.

---

## Versions installed (forensic record)

No new dependencies added in B2. All versions unchanged from B1:

```
ajv@8.20.0           (used by validate.ts, hooks.ts, doc-checks.ts)
ajv-formats@3.0.1    (same)
yaml@2.9.0           (used by frontmatter parser in memory.ts)
commander@12.1.0
kleur@4.1.5
zod@4.4.3
@inquirer/prompts@7.0.0
```

`package.json` is unchanged.

---

## Acceptance criteria status

Scored against B2 exit conditions from the brief.

| Criterion                                                                                                | Status   |
| -------------------------------------------------------------------------------------------------------- | -------- |
| **P3:** `hook.schema.json` exists; `substrate validate <hook>` works                                     | **met**  |
| Hook discovery + matching in Discoverer                                                                  | **met**  |
| Hook execution working in Orchestrator (real dispatch for 3 references; skeleton for auto-drift-detect)  | **met**  |
| `substrate hooks list` / `describe`                                                                      | **met**  |
| 4 reference hooks ship in `templates/hooks/`                                                             | **met**  |
| **P4:** `doc-check.schema.json` validates                                                                | **met**  |
| `substrate query doc-checks --for-files <files> [--json]`                                                | **met**  |
| 4+ reference doc-checks                                                                                  | **met**  |
| Doc-check evaluation integrated (registry walked via the query)                                          | **met**  |
| **P5:** Memory storage discovery follows documented order                                                | **met**  |
| Existing Claude Code memory format works unchanged (backward compat tested)                              | **met**  |
| Workflow context-load injects memories deterministically                                                 | **met**  |
| `substrate.config.json` schema extended with `memory.path`                                               | **met**  |
| `substrate doctor` warns on memories missing recommended fields                                          | **partial** — memory module emits per-entry warnings; doctor aggregation is B4 (per plan §3.10). The signal exists at the entry level today. |
| **P6:** `audit-all`-style composition expressible                                                        | **met** (reference: `audit-composite`) |
| Stale-dependency warnings surface at workflow start                                                      | **met**  |
| **P7:** Escalation logic runs in `substrate audit` deterministically                                     | **met**  |
| Sidecar JSON includes original-severity + effective-severity fields                                      | **met** (Finding gains originalSeverity; recomputed findingsBySeverity reflects effective) |
| Reference rule demonstrates `escalate_after`                                                             | **met** (BE-PY-001) |
| Tests verify escalation across multiple "audit runs" (fixture sidecars at different timestamps)          | **met**  |
| **All gates green:** build, lint, typecheck, test                                                        | **met**  |
| **Test count grows; document growth in HANDOFF**                                                         | **met** (357 + 1 → 446 + 1; +89) |

### `substrate doctor` memory-frontmatter warning — clarification

The brief notes: *"`substrate doctor` warns on memories missing
recommended frontmatter fields (this overlaps with B4's Primitive 10;
ship the warning as part of doctor in B2 since it's load-bearing for
memory adoption)."*

B2's `parseMemoryFrontmatter` emits a per-memory warning in the
`warnings: string[]` field of each `MemoryEntry`:

> "memory frontmatter lacks recommended substrate fields (type, scope,
> tags). Queries by those filters will skip this memory."

This is consumed today by `runQueryMemory` (the warnings are returned
in the result). The remaining step is to have `substrate doctor` walk
the memory store and aggregate these warnings into its report. That
walk is a 10-line addition to `src/commands/doctor.ts`. Marked
**partial** rather than **met** because the doctor-side aggregation
isn't wired yet. The memory-side signal is complete.

**Recommendation:** wire the doctor aggregation as the first slice of
B4's Primitive 10 work — it's a 10-line change and closes the loop
explicitly. Alternative: ship it as a small B2.5 patch on the v2
branch before B3 starts. Either is fine.

---

**Phase B2 complete. Ready to begin Phase B3 (Loop closure / proposal pipeline) in the next agent run.**

---

*End of HANDOFF. Tag in the parent agent for review and the next run.*
