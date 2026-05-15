# Substrate v2 — Phase B1 (Foundation) Handoff

> **Status:** B1 complete. All four sub-phases shipped.
> **Branch:** `v2` (4 commits ahead of `main`)
> **Test count:** 357 passed + 1 skipped (started at 295 + 1; +62 new)
> **Gates:** build, lint, typecheck, test — all green.
> **Next agent run:** Phase B2 (Reinforcement) — see plan §11.

This is the first agent run on Substrate v2. v1.0 surface is intact;
v2 is purely additive under `src/v2/` + `schemas/` +
`templates/workflows/`.

---

## Completed in this run

### Commits (newest first)

| SHA       | Message                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `bb6cb60` | feat(v2): three reference workflow templates [substrate-v2-B1]                         |
| `ed05b3f` | docs(v2): two-layer architecture model [substrate-v2-B1]                               |
| `ba38b3c` | test(v2): cover discoverer, context-loader, query, run [substrate-v2-B1]               |
| `3845f70` | feat(v2): workflow manifest schema + validator + two-layer scaffolding [substrate-v2-B1] |

### Files changed (high level)

**New (v2 module tree):**

- `packages/substrate/schemas/workflow.schema.json` — JSON Schema for v2
  workflow manifests (draft-07, conditional `required` on step types).
- `packages/substrate/src/v2/types.ts` — TypeScript types mirroring the schema.
- `packages/substrate/src/v2/validate.ts` — `validateManifest` /
  `validateManifestFile` (ajv@8 powered, lazy-loaded schema).
- `packages/substrate/src/v2/discoverer.ts` — `discoverWorkflows`,
  `findWorkflowById`, `findWorkflowsByKind`. Walks
  `substrate/workflows/`; sorts by id; segregates invalid manifests.
- `packages/substrate/src/v2/context-loader.ts` — `loadContext` resolves
  standards + rules; memory + knowledge are stubbed per B1 scope with
  B2/B4-deferred warnings.
- `packages/substrate/src/v2/deterministic/validate-command.ts` —
  `substrate validate [path]` CLI command (exit 0/1/2).
- `packages/substrate/src/v2/deterministic/query-command.ts` —
  `substrate query rules|standards|memory` CLI commands.
- `packages/substrate/src/v2/orchestrator/run-command.ts` —
  `substrate run <workflow>` skeleton; runs `invoke-deterministic` and
  `run-tool` steps fully; surfaces deferred for AI-step types.
- `packages/substrate/src/v2/deterministic/index.ts` — namespace barrel.
- `packages/substrate/src/v2/orchestrator/index.ts` — namespace barrel.

**New (templates):**

- `packages/substrate/templates/workflows/audit-service.yaml` + `.body.md`
- `packages/substrate/templates/workflows/audit-package.yaml` + `.body.md`
- `packages/substrate/templates/workflows/tackle-task.yaml` + `.body.md`

**New (tests):**

- `tests/v2-validate.test.ts` (16 tests)
- `tests/v2-discoverer.test.ts` (11 tests)
- `tests/v2-context-loader.test.ts` (11 tests)
- `tests/v2-query.test.ts` (9 tests)
- `tests/v2-run.test.ts` (6 tests)
- `tests/v2-reference-templates.test.ts` (9 tests)

Total new tests: **62** (357 from 295 baseline).

**New (docs):**

- `docs/architecture.md` — the two-layer model. Maps every command +
  every primitive to its layer.

**Modified:**

- `packages/substrate/package.json` — adds `ajv` and `ajv-formats` runtime
  deps; adds `schemas` to `files` for npm publish.
- `packages/substrate/src/cli.ts` — wires `validate`, `query`, `run`
  v2 commands into the commander tree.
- `packages/substrate/src/index.ts` — exposes `deterministic` and
  `orchestrator` namespaces alongside v1 flat re-exports.
- `package-lock.json` — dependency lock for ajv@8 + ajv-formats@3.

### Design decisions taken

1. **Two-layer namespace pattern.** Exposed v2 as
   `import { deterministic, orchestrator } from "@op4z/substrate"`
   rather than scattered flat exports. Rationale: makes layer
   intent explicit at every import site; preserves v1.0 flat
   re-exports for back-compat. Alternative considered:
   sub-package paths (e.g.
   `@op4z/substrate/deterministic`); rejected because npm subpath
   exports add packaging surface that's painful to validate
   pre-publish — wait until there's a real reason.

2. **JSON Schema draft-07, not draft-2020-12.** ajv@8 supports both,
   but draft-07's tooling ecosystem (editor support, online
   validators, vscode-yaml integration) is better. Rationale: lower
   friction for workflow authors editing manifests in their IDE.

3. **Conditional `required` via `allOf` + `if/then`.** Step-type
   shape varies (prompt steps need `prompt`; invoke-deterministic
   steps need `run`). Modeled as `allOf` rules on the step object
   rather than a discriminated union per step type. Rationale:
   keeps the schema readable; ajv reports clean violations
   ("must have required property 'run'") rather than wrestling
   with oneOf branches.

4. **`substrate validate` exit codes 0/1/2.** Distinct codes for
   clean / schema-violation / file-not-found. Matches the audit
   command's gate pattern (pass/conditional/fail = 0/1/2).
   Rationale: CI scripts can react differently — a missing file
   is an integration problem; a schema violation is a content
   problem.

5. **`substrate run` deferred-step exit code 2.** When B1 hits a
   `prompt` step, the step status is `deferred` and the workflow
   halts with exit 2. Rationale: this is structurally different
   from `failed` (the user knows the step engine isn't ready).
   Tests can match on exit code OR step.status to assert the
   deferred condition.

6. **Memory loading stubbed; declaration warned.** Workflows can
   already declare `context.memory.{types,scope,tags}` in their
   manifest. B1's context-loader emits a B2-deferred warning when
   any memory declaration is present, but otherwise no-ops. The
   seam is intentional — B2 swaps the stub for real loading;
   manifests don't need to change. Same pattern for
   `knowledge-sections` (B4-deferred).

7. **Discoverer walks shallow only.** `substrate/workflows/*.yaml`
   — no recursion into subdirs. Rationale: keeps the model simple;
   nested subdirs are reserved for future use (templates/ inside
   workflows/, etc.).

8. **Reference template style: manifest + sibling .body.md.** The
   YAML carries the schema fields (id, steps, context); the body
   is the prose program the AI session reads. Pattern locked
   per §1/§4 of the plan. Rationale: keeps YAML auto-validatable
   and renders well in docs.

9. **`substrate run` for `tackle-task` halts at step 1 in B1.** All
   eight steps are AI-orchestrated except `service-validation`.
   The first step (`research`) is `type: prompt` → deferred. This
   is the **correct** B1 behavior; the integration test asserts it
   explicitly so the B2 work has a target.

10. **ajv error format mapped through `formatAjvErrors`.** ajv's
    raw errors include `instancePath`, `schemaPath`, `keyword`,
    `params`, `message`. We surface `path` (= instancePath), the
    keyword, the message, and the params bag. Rationale: callers
    get a CLI-friendly shape without needing to know ajv's
    internal structure; `params` carries the discriminator data
    (e.g. required property name) for richer CLI output.

### Tests added — coverage map

| File                                  | Tests | What it locks down                                                |
| ------------------------------------- | ----- | ----------------------------------------------------------------- |
| `v2-validate.test.ts`                 | 16    | schema acceptance, rejection, file modes, CLI exit codes          |
| `v2-discoverer.test.ts`               | 11    | empty/missing/parse-error paths, sort order, body.md siblings     |
| `v2-context-loader.test.ts`           | 11    | standards precedence, rules glob, memory/knowledge stub warnings  |
| `v2-query.test.ts`                    | 9     | rules filtering, standards walk, memory stub, --json shape        |
| `v2-run.test.ts`                      | 6     | dispatch + exit codes (0/1/2), deferred steps, dry-run, context summary |
| `v2-reference-templates.test.ts`      | 9     | all 3 references valid + runnable; tackle-task halts at step 1   |

---

## Pending / next up (priority order)

### Phase B2 (next agent run) — Reinforcement

Per plan §11:

1. **First-class memory integration (P5).** The deterministic-layer
   stub seams are in place (`context.memory.*` declarations are
   parsed, the schema validates them, the context-loader has the
   `TODO (B2)` marker). Plan §6 has the complete design — Claude
   Code path bridge, frontmatter extensions, query API. Net new
   modules: `src/v2/memory.ts` (read), `src/v2/memory-write.ts`
   (the `substrate memory write` deterministic command).

2. **Cross-cutting hooks (P3).** New module `src/v2/hooks.ts`. The
   manifest already accepts `hooks.cross-cutting`; B2 makes that
   field actually invoke hooks. Reference hooks ship in
   `templates/hooks/` (4+: auto-emit-sidecar, auto-update-trend,
   auto-propose-tasks, auto-drift-detect).

3. **Conditional-doc-check registry (P4).** New module
   `src/v2/doc-checks.ts`. The schema doesn't carry doc-check
   shape yet (it's not a workflow concept); add a new schema at
   `schemas/doc-check.schema.json`. Reference registry ships in
   `templates/doc-checks/`.

4. **`composes_findings_of` runtime (P6).** Schema already accepts
   the field. B2 implements: fresh-within check, sub-workflow
   provenance, stale-dependency warnings.

5. **`escalate_after` runtime (P7).** Lives in the audit subsystem,
   not v2 module. Adds age-based severity escalation per finding.

6. **Step engine — AI-step types.** This is the biggest single
   piece. The `runV2Workflow` skeleton needs to handle `prompt`,
   `prompt-and-action`, `invoke-sub-workflow`, `gate`, `discover`,
   `propose-doc-change`. Cleanest approach: each step type gets a
   handler module under `src/v2/orchestrator/steps/`, the
   dispatcher in `run-command.ts` becomes a registry.

### Phase B3 — Loop closure

7. **Proposal pipeline (P9).** The headline. Session-event-log,
   drift detection, typed proposals, queue, walk command,
   applicators. Plan §3.9 + §7 have the worked example.

8. **`trigger: schedule` runtime (P8).** Schema already accepts.
   Reference workflow `weekly-proposal-walk` ships.

### Phase B4 — Polish + release

9. **`substrate doctor` v2 (P10).** Add checks for rules-doc-coverage,
   workflow-coverage, memory-frontmatter, stale-proposals,
   escalation-debt.

10. **Plural knowledge sources (P11).** Knowledge module accepts
    `kind: kubernetes` and `kind: env-registry`. Current stub
    warns; B4 implements.

11. **`substrate init` v2 enhancements.** Currently init scaffolds
    workflows as IDs only; v2 should optionally copy the reference
    `.yaml + .body.md` pairs into the consumer's
    `substrate/workflows/`. Deferred from B1 because the brief
    constrained changes to v1.0 surface.

12. **README + docs-site updates.** B1 added `docs/architecture.md`
    in the docs/ tree. The `docs-site/` Astro site still describes
    v1.0 only; v2 surface coverage lands in B4.

13. **Version bump 1.x → 2.0.0.** Per brief: stay at 1.0.0 during
    development; bump in B4 immediately before publish.

---

## Open questions for the user

The 7 open questions in plan §12 are answered (Beau's "Recommend:"
locks are in effect). No NEW questions emerged from B1 implementation.

One observation that may merit later discussion (not blocking B2):

- **Schema vs. v1 workflow shape (`auto/config/workflows.yaml`).**
  The v1 workflow format is preserved by `commands/workflow.ts`
  (loose-typed; type=command/audit/prompt; uses `${var}`
  substitution). The v2 schema is strict and namespaced under
  `substrate/workflows/`. They co-exist cleanly in B1 (different
  paths, different commands). When migration happens (post-B4),
  there's a choice: write a codemod from v1 → v2, or leave v1
  workflows operational alongside v2. **Recommend:** codemod. The
  v1 shape doesn't carry context declarations, memory hooks, or
  the step types v2 introduces — migrating opens those up. But
  this is a B4+ decision; no action needed in B2.

---

## Notes for the next agent

### Where the seams are

- **Memory:** `src/v2/context-loader.ts:loadContext` has a `TODO
  (B2)` comment exactly where the memory loader plugs in. The
  function returns `memories: []` and emits a warning when
  `context.memory` is declared. B2 swaps this for real loading;
  manifests don't change.

- **Knowledge:** same pattern in the same file. `TODO (B4)`.

- **Step engine:** `src/v2/orchestrator/run-command.ts:runStep`
  switches on step.type. Today the dispatch returns `deferred`
  for AI-step types. B2 replaces those cases with handler calls.
  Tests in `v2-run.test.ts` and `v2-reference-templates.test.ts`
  assert the deferred behavior — those test names mention "B2"
  in the assertion messages so when B2 ships, the tests update
  to assert the new flow.

- **Cross-cutting hooks:** `src/v2/orchestrator/run-command.ts`
  does NOT yet invoke `hooks.cross-cutting`. The manifest schema
  accepts the field; runtime dispatch is B2.

### Conventions established

1. **All v2 modules live under `src/v2/`.** Two subdirectories:
   `deterministic/` and `orchestrator/`. Library modules
   (discoverer, context-loader, validate, types) sit at
   `src/v2/` root.

2. **All v2 commands take `--json` and `--quiet`.** CI consumers
   parse JSON; humans suppress with `--quiet`.

3. **All v2 commands take `cwd?` as a test seam.** Tests pass
   `cwd: tmp`; the CLI defaults to `process.cwd()`.

4. **Reference templates live in `templates/workflows/`.** They
   ship in the npm bundle (`files` includes `templates`). When
   `substrate init` v2 lands (B4), it copies them into the
   consumer's `substrate/workflows/`.

5. **JSON Schema location: `packages/substrate/schemas/`.**
   `files` includes `schemas` for npm publish. The schema is
   loaded at runtime via fs walk (same pattern as `templates/`)
   so it works in both `dist/` and `src/` (tests).

6. **Tests follow vitest convention: `tests/<feature>.test.ts`.**
   v2 tests are prefixed `v2-` to make grouping obvious.

### Gotchas

1. **ajv resolution.** Root `node_modules/ajv` is v6 (transitive
   from eslint). The substrate package's own `node_modules/ajv`
   is v8.20.0. TypeScript resolves correctly because the imports
   inside `src/v2/validate.ts` resolve through the package's
   `node_modules`. If you see `ajv@6` issues at runtime, check
   the `npm ls ajv` tree for the package being tested.

2. **ajv default export shape.** With `esModuleInterop: true` and
   ajv@8's CJS shape, `import Ajv from "ajv"` works but TypeScript
   types report the namespace. The validator uses an explicit
   `(Ajv as unknown as { default?: ... }).default ?? Ajv` cast
   in `validate.ts:getValidator` — it's verbose but it survives
   both ESM-default-export and CJS-default semantics. If a
   simpler alternative emerges in a future TypeScript release,
   the cast is safe to remove.

3. **`runV2Workflow` for AI-step workflows halts but doesn't
   throw.** The CLI sets `process.exitCode = 2` on deferred halt.
   Tests assert via `result.exitCode === 2` AND
   `result.steps[0].status === "deferred"`. Don't change the
   exit code to 0 — downstream automation will mistakenly think
   the workflow succeeded.

4. **`new-service.yaml` is v0.5 (legacy).** It exists in
   `templates/workflows/` for v0.5 backwards-compat. It does NOT
   pass the v2 schema. The reference-templates tests
   deliberately seed only the three v2 manifests (filter by
   `REFERENCE_IDS`) so it doesn't poison the suite. If you add
   more v2 templates, add their ids to that constant.

5. **Memory bridge path.** `src/v2/context-loader.ts` does NOT
   currently read from `~/.claude/projects/<encoded>/memory/`.
   That bridge is a B2 concern. The frontmatter parser at
   `src/util/frontmatter.ts` is the minimal v1 parser; B2 will
   need to extend it to handle the metadata block (per plan §6.2).

### Don't do these

1. **Don't bump `package.json` to 2.0.0.** Per hard rule #2. The
   version stays at 1.0.0 throughout v2 development; B4 bumps it
   immediately before publish.

2. **Don't push to GitHub or npm publish.** Per hard rules #3/#4.
   Local-only until Beau's GH org recovery resolves.

3. **Don't refactor v1.0 surface.** Two-layer architecture is
   accomplished via labeling + namespaced exports; the
   underlying v1 modules are untouched. v1 tests still pass.

4. **Don't add new top-level CLI commands without a layer
   classification.** Every command goes under the v2 split.
   Update `docs/architecture.md`'s table when you add one.

---

## Versions installed (forensic record)

```
ajv@8.20.0           (npm view ajv@latest = 8.20.0; confirmed)
ajv-formats@3.0.1    (npm view ajv-formats@latest = 3.0.1; confirmed)
```

Both pinned via package.json:

```json
"ajv": "^8.20.0",
"ajv-formats": "^3.0.1"
```

Other v2 dependencies (already present from v1.0): `yaml@2.9.0`,
`commander@12.1.0`, `kleur@4.1.5`, `zod@4.4.3`,
`@inquirer/prompts@7.0.0`.

No new devDependencies added.

---

## Acceptance criteria status

Pulled from the brief, scored against B1 exit conditions:

| Criterion                                                                                          | Status |
| -------------------------------------------------------------------------------------------------- | ------ |
| Manifest schema documented + JSON Schema validator shipped (`substrate validate <workflow>`)       | **met** |
| 3 reference workflow templates ship in `templates/workflows/` (audit-service, audit-package, tackle-task) | **met** |
| `substrate validate` works for all 3 references (exits 0)                                          | **met** |
| `substrate run <workflow>` works for invoke-deterministic-only workflows (full multi-step AI flow is B2) | **met** |
| Two-layer architecture refactor: deterministic commands invokable without AI; programmatic API exposes both layers | **met** |
| `docs/architecture.md` documents the two-layer model                                               | **met** |
| Discoverer + Context-loader implemented with tests; memory loading stubbed (B2 will complete)      | **met** |
| All gates green: build, lint, typecheck, test (start from 296 passed + 1 skipped)                  | **met** (357 + 1) |
| Test count grows; document growth in HANDOFF                                                       | **met** (+62) |

**Phase B1 complete. Ready to begin Phase B2 in the next agent run.**

---

*End of HANDOFF. Tag in the parent agent for review and the next run.*
