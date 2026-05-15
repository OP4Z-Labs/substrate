# Substrate — CHANGELOG

All notable changes to the substrate CLI are documented in this file.
Adheres roughly to [Keep a Changelog](https://keepachangelog.com).

## [2.0.0] — 2026-05-15 — Workflow Runtime + Proposal Pipeline

v2.0 layers an AI-orchestrated workflow runtime over the v1.0
detector + standards foundation, and ships the headline primitive of
the release: a self-reinforcement loop where every workflow run
observes itself and proposes improvements to the conventions it
just executed. Eleven primitives total. v1.0 surface is unchanged —
v2.0 is fully additive.

### Added — Phase B1 (Foundation)

- **Workflow manifest schema + validator** (Primitive 1). Declarative
  YAML manifests at `substrate/workflows/<id>.yaml` paired with a
  `<id>.body.md` prose body. Full JSON Schema at
  `packages/substrate/schemas/workflow.schema.json`.
  `substrate validate [path]` checks one file or walks the directory.
- **Two-layer architecture** (Primitive 2). Deterministic primitives
  (discoverer, context loader, query commands, validators) safe to
  call from CI / hooks / scripts. Orchestration layer (drives AI
  session) wraps the deterministic layer.
- **Discoverer + Context loader.** Pure modules that walk
  `substrate/workflows/`, validate manifests, and resolve
  `context.standards | memory | rules | knowledge-sections` into a
  structured `Context` for the orchestrator.
- **`substrate run <workflow-id>`** — orchestration-layer command
  that loads the manifest, resolves context, fires hooks, executes
  steps, and emits session events.
- **Three reference workflow templates:** `tackle-task`,
  `audit-service`, `audit-package`. Drop-in starting points.
- **`substrate query` family:** `query rules`, `query standards`,
  `query memory`, `query doc-checks`, `query sessions`. Pure
  read/filter commands; every form supports `--json`.

### Added — Phase B2 (Reinforcement)

- **Cross-cutting hooks** (Primitive 3). One YAML file declares
  "fire this on every workflow-completion when X" — applies to every
  workflow, no per-workflow copy-paste. Four built-in hooks:
  `auto-emit-sidecar`, `auto-update-trend`, `auto-propose-tasks`,
  `auto-drift-detect`. Hook schema at `schemas/hook.schema.json`.
- **`substrate hooks list / describe`** — deterministic inspection.
- **Conditional doc-check registry** (Primitive 4). Manifests at
  `substrate/doc-checks/<id>.yaml` declare "if commit-message
  matches X, require changed-files-any Y." Used as pre-commit /
  pre-merge gates. Schema at `schemas/doc-check.schema.json`.
- **First-class memory integration** (Primitive 5). Reads
  Claude Code's memory directory by default; resolves via flag →
  env → config → bridge precedence. Frontmatter extensions: `type`,
  `scope`, `tags`, `expires`. `queryMemory()` filters by type /
  scope / tags / changed-file overlap.
- **`composes_findings_of`** (Primitive 6). Cross-workflow
  dependency — `review-pre` can compose findings from
  `audit-package`. Optional `require-fresh-within` guard.
- **`escalate_after`** (Primitive 7). Age-based severity escalation
  on RULES.yaml entries. Findings gain `originalSeverity`,
  `firstSeenAt`, `ageDays`, and post-escalation `severity`.

### Added — Phase B3 (Loop closure)

- **Proposal pipeline** (Primitive 9, the headline). Every
  `substrate run` writes a JSONL session-event-log to
  `substrate/sessions/<workflow>-<sha>.jsonl`. The `auto-drift-detect`
  hook runs six built-in drift detectors (`adhoc-step`,
  `skipped-step`, `out-of-order`, `context-gap`,
  `repeated-prompt`, `rule-violation-recurrence`) and classifies
  findings into eight typed proposals: `add-to-workflow-step`,
  `add-to-memory`, `strengthen-context-load`, `add-to-rule`,
  `add-to-doc-check-registry`, `add-to-standards-doc`,
  `cross-link-existing`, `add-to-adr`. Pending proposals land at
  `substrate/proposals/pending/<date>-<workflow>-<sha>.md`.
- **`substrate review --proposals`** — interactive walker with five
  controls (accept / reject / edit / defer / skip). `--dry-run`
  preserves the queue; `--batch-confirm` auto-accepts
  high-confidence proposals and defers the rest.
- **Applicators.** Each proposal kind has a deterministic applicator:
  workflow manifest edits via comment-preserving YAML helpers,
  RULES.yaml appends, memory frontmatter writes (B2 storage
  discovery), ADR drafts auto-incrementing DEC-XXX numbering,
  doc-check registry writes, standards-doc + cross-link drafts with
  embedded `<!-- substrate-proposal: <id> -->` anchors.
- **`trigger: schedule`** (Primitive 8). Three forms: cron, interval,
  every-n-commits. In-house 5-field cron parser (`*`, ranges,
  comma-lists, step, named days/months). State at
  `substrate/scheduler/state.json`.
- **`substrate scheduler --check`** — non-invasive scheduler
  inspection (lists due workflows; never invokes anything).
- **`weekly-proposal-walk` reference workflow** — scheduled cron
  trigger that shells out to `substrate review --proposals
  --batch-confirm`.
- **Comment-preserving YAML edit helpers** (`yaml-edit.ts`) —
  `appendListItem`, `insertListItemAfter`, `appendToMapKey`.
  Capped at depth 2; rejects unknown shapes loudly.
- **`substrate doctor --check memory-frontmatter`** — aggregation
  of per-memory frontmatter warnings.

### Added — Phase B4 (Polish + Release)

- **`substrate doctor` v2 checks** (Primitive 10 remainder):
  `rules-doc-coverage`, `workflow-coverage`, `stale-proposals`,
  `escalation-debt`. Each addressable individually via
  `--check <name>`; aggregate run includes all of them. `--json`
  works on every form.
- **Plural knowledge sources** (Primitive 11). New
  `substrate/knowledge-sources.yaml` manifest declares typed source
  entries. Built-in plugins: `docker-compose` (existing),
  `kubernetes` (new), `env-registry` (new). Custom-plugin contract
  documented in `docs/knowledge-sources.md`. The kubernetes plugin
  reads Service / Deployment / StatefulSet / Secret / ConfigMap
  resources (Secret + ConfigMap surface keys only — values never
  leave the filesystem).
- **`substrate query sessions`** — CLI wrapper around B3's
  `indexSessionLogs` + `readSessionLog` primitives. Newest-first
  index of `substrate/sessions/*.jsonl`. `--workflow` filter,
  `--limit` cap, `--include-events` to embed parsed events.
- **Docs site v2.0 update.** Three new pages: `/workflows`,
  `/proposals` (the headline explainer), `/knowledge-sources`.
  Refreshed: home / commands / quick-start.
- **`docs/migration-from-1.x.md`** — migration guide. v2.0 is
  fully additive — no breaking changes from 1.x.
- **`docs/release-2.0-checklist.md`** — publish checklist.

### Changed

- `SUBSTRATE_VERSION` bumped from `1.0.0` to `2.0.0`.
- `packages/substrate/package.json` version bumped to `2.0.0`.
- Root `substrate-monorepo` package.json version bumped to `2.0.0`.
- `substrate doctor` now aggregates the v2 checks (B2 memory-
  frontmatter + B4 rules-doc-coverage / workflow-coverage /
  stale-proposals / escalation-debt) alongside v1.0's baseline
  checks. `--check <name>` scopes to one slice.
- Audit JSON sidecar (`substrate/audits/<scope>-latest.json`)
  findings carry the escalation tracking fields
  (`originalSeverity`, `firstSeenAt`, `ageDays`, `severity` =
  effective) when `escalate_after` is configured on the rule.
- `HookFiringContext` interface extends with optional `manifest`,
  `sessionLogPath`, `cwd` fields (B3). Existing hooks ignore the
  new fields — fully backwards-compatible.
- `RunWorkflowResult` surfaces an optional `sessionLogPath`
  attribute (B3).
- Session-event-log `session-log.ts` docstring corrected:
  telemetry contract version stays at `v: 2` for v2.0. The
  session-event-log is a separate channel without its own
  `version` field — the event discriminant is the contract.

### Deprecated

- None in v2.0 itself. (v1.0's `detector.type: shell` deprecation
  persists.)

### Removed

- None. v1.0 surface remains operational.

### Fixed

- `INF-DOCKER-002` (B2): the rule's YAML detector was tripped by
  benign cases; ripgrep pattern tightened.
- B3: `auto-drift-detect` hook replaced its B2 skeleton handler
  with the real `runProposalPipeline()` integration. Defensive
  `status=skipped` fallback when fired outside the orchestrator path.

### Test count

- v1.0 baseline: 305+ tests.
- v2.0: 608 passed + 1 skipped across 59 test files (substrate +
  adapters). Phase deltas:
  - B1: discoverer + context-loader + query + run
  - B2: +141 (hooks, doc-checks, memory, composition, escalation)
  - B3: +127 (session-log, drift detectors, classifier, queue,
    pipeline-e2e, yaml-edit, applicators, review, scheduler,
    doctor-memory)
  - B4: +35 (doctor v2 checks, query sessions, knowledge sources)

### Migration

See `docs/migration-from-1.x.md`. **Short version: no breaking
changes.** v2.0 is fully additive — same `substrate audit`, same
standards bundle, same init/upgrade flow; new commands and new
YAML files in `substrate/`. Existing v1.x consumers keep working
without changes.

---

## [1.0.0] — 2026-05-14 — General Availability

### Added — Phase A (audit detector runtime)

- `substrate audit` now runs RULES.yaml detectors against the repo.
  Three detector types: `ripgrep`, `script` (sandboxed worker thread),
  `composite` (all / any / none operators).
- `--rule <id>` runs a single rule.
- `--diff` restricts ripgrep detectors to staged-diff files.
- `--trend` reads `substrate/audits/_trend.jsonl` and prints per-scope
  history.
- `--rules-path` overrides the rules file location.
- `--strict` makes unknown YAML fields fatal.
- `--no-report` skips writing report files.
- Reports land at `substrate/audits/<scope>-YYYY-MM-DD.md` plus a JSON
  sidecar and an append-only `_trend.jsonl`.
- Script-detector sandbox: empty env, filesystem reads constrained
  to `repoRoot`, 30s default timeout (max 5 min) enforced via
  `worker.terminate()`.
- Detector contract documented in `docs/audit-runtime.md`.

### Added — Phase B (21 standards docs with pragmatic bodies)

- All 21 standards docs ship with opinionated bodies (~200-300 lines
  each):
  - **Backend (10):** architecture, api, **api-versioning (new)**,
    database, error-handling, **messaging (new)**, observability,
    python, security, testing.
  - **Frontend (7):** react, typescript, accessibility, performance,
    testing, data-management, logging.
  - **Infrastructure (2):** ci-cd, docker.
  - **Operations (3):** runbooks, **database-ops (new)**, feature-flags.
- Each doc has Scope / Rules / Examples / Rationale sections.
- Rules cross-link to IDs in `cross-cutting/RULES.yaml`.
- Docs-site standards page updated to list all 21 docs.

### Added — Phase C (cross-cutting)

- **Atomic-write helper** (`src/util/atomic-write.ts`) used for
  crash-safe writes of manifest + audit reports.
- **Programmatic API** exported from `substrate` package
  (`runInit`, `runAuditExecute`, `loadRules`, `runAudit`, etc.).
  Documented in `docs/programmatic-api.md`.
- **`--json` flag** on every command that produces output.
- **`substrate telemetry show / purge / export`** — transparency
  commands. JSONL + CSV export.
- **`--telemetry-endpoint <url>`** flag for forwarding telemetry to
  a user-configured collector (opt-in extra; local-by-default
  unchanged).
- **`substrate uninstall`** command. `--dry-run` shows the plan;
  preserves user-modified files by default; `--force` removes them
  anyway.
- **CI matrix** expanded to Node 20 + 22 + 24.
- **`docs/compatibility.md`** documents supported platforms.
- **`substrate doctor`** now reports Node version + ripgrep + git
  availability.
- **`CONTRIBUTING.md`** and `.github/ISSUE_TEMPLATE/` for bug
  reports, feature requests, and rule contributions.

### Added — Phase D (v1.0 polish)

- **`docs/config-schema-v1.md`** — frozen schema reference.
- **`docs/migration-from-0.x.md`** — exhaustive migration guide.
- **`docs/case-studies/`** — 5 templated slots + a worked OP4Z
  self-case-study.
- **`docs/contributing-rules.md`** — workflow for proposing rules
  to the curated public registry.
- **`packages/substrate/templates/rules-registry/`** — directory for
  community rule contributions with a worked example
  (`no-todo-comments.yaml`).
- **`docs/release-1.0-checklist.md`** — npm-publish checklist (NOT
  executed by automation).
- **`templates-history/1.0.0/`** snapshot for future three-way merge.

### Changed

- `SUBSTRATE_VERSION` bumped from `0.8.0` to `1.0.0`.
- Default substrate.config schema documented as frozen at v1.0.
- The shipped `RULES.yaml` skeleton is expanded from 15 generic
  rules to 35 rules covering all 21 standards docs.

### Deprecated

- `detector.type: shell` in RULES.yaml. Still loads, but the runtime
  treats it as a no-op with a warning. Use `script` or `ripgrep`
  instead.

### Removed

- None. All v0.x surface remains operational.

### Test count

- v0.8 baseline: 272 tests across 31 files (substrate + 39 adapter
  tests).
- v1.0: 305+ tests across 35+ files (273+ substrate + 39 adapter).

### Migration

See `docs/migration-from-0.x.md`. The short version: existing
`substrate.config.json` files keep working; `substrate audit` runs the
new detector runtime (replacing the v0.x stub); v0.x `shell`
detectors deprecated but still loaded.

---

## [0.8.0] — 2026-05-14

(See [.agent/HANDOFF-2026-05-14-v08.md](.agent/HANDOFF-2026-05-14-v08.md).)

- Templates-history shipping path + true three-way merge.
- Monorepo migration via npm workspaces.
- MCP server bridge (stdio transport).
- GitHub Action wrapper.
- 3 reference adapters: Linear, Jira, GitHub Issues.
- Astro docs site (dogfooded).
- Telemetry opt-in (local-only).
- LICENSES.md (MIT for code + CC-BY-4.0 for content).

## [0.5.0] — 2026-05-14

- YAML library swap (yaml-mini → eemeli yaml).
- Manifest-tracked `substrate upgrade --apply` with three-way-style
  merge.
- TaskAdapter + VcsAdapter plugin contracts.
- Cursor bridge.
- Multi-step workflow runtime.

## [0.3.0] — 2026-05-14

- Stack auto-detection (Python / TS / Go / Rust).
- 15-audit catalog.
- 21-standards-doc scaffolds (with TODO bodies — fleshed out in
  v1.0).
- `substrate add` for individual scaffolding.
- `substrate knowledge refresh` (docker-compose + .env).
- `substrate doctor`.

## [0.1.0] — 2026-05-14

- Initial skeleton.
- `substrate init` with 7-subdir `auto/`.
- `substrate audit --list` / `--type` (stub).
- `substrate create --template package-{ts,python}`.
- Claude bridge.

[2.0.0]: https://github.com/op4z/substrate/releases/tag/v2.0.0
[1.0.0]: https://github.com/op4z/substrate/releases/tag/v1.0.0
[0.8.0]: https://github.com/op4z/substrate/releases/tag/v0.8.0
[0.5.0]: https://github.com/op4z/substrate/releases/tag/v0.5.0
[0.3.0]: https://github.com/op4z/substrate/releases/tag/v0.3.0
[0.1.0]: https://github.com/op4z/substrate/releases/tag/v0.1.0
