# Substrate — CHANGELOG

All notable changes to the substrate CLI are documented in this file.
Adheres roughly to [Keep a Changelog](https://keepachangelog.com).


## [3.0.0-beta.4] — 2026-06-17

### Fixed

- **`audit --diff` no longer silently scans the entire repository when git can't resolve the diff.** `listDiffPaths` previously returned `null` for both "not a git repo" and "git command failed", and the audit runner treated `null` as "run every rule against everything". A transient git condition (a stale `.git/index.lock`, a concurrent git operation) therefore turned a diff-scoped audit into a misleading, non-deterministic whole-repo report — with no signal that it had degraded.
  - `listDiffPaths` now returns a discriminated result: `{ kind: "files" }`, `{ kind: "no-git" }`, or `{ kind: "git-error", detail }`. Unborn-branch repos (no commits yet) are handled explicitly — `git diff HEAD` is only attempted when `HEAD` exists; untracked files are still captured.
  - `audit --diff` **fails loudly** on `git-error` (throws, or emits a `diff-unresolved` JSON error and exits non-zero) instead of full-scanning. `no-git` still degrades to a full scan but now emits a warning and reports `scope: all`. An empty diff still short-circuits to an empty report.
- **The Node fallback detector now respects `.gitignore`, matching the ripgrep path.** The fallback walker honored only its hardcoded exclude globs, so it descended into gitignored directories that `rg` skips — most painfully agent worktrees (`.claude/worktrees/`), which are full repo copies and multiplied every finding by the number of live worktrees. The walker now intersects against `git ls-files --cached --others --exclude-standard` (cached per repo root) so the two detector paths produce equivalent findings, as their contract requires.

### Changed

- `DEFAULT_EXCLUDES` gains `.mypy_cache/**`, `.ruff_cache/**`, and `.claude/worktrees/**`.

## [3.0.0-beta.3] — 2026-06-17

### Fixed

- **Published tarball now contains `dist/`.** Both `3.0.0-beta.1` and `3.0.0-beta.2` shipped without `dist/` due to a stale `tsconfig.tsbuildinfo` causing the incremental `tsc -b` invocation in `prepublishOnly` to no-op. The `npm run clean` step removed `dist/` but not the `tsbuildinfo`, so the rebuild thought everything was up-to-date and produced zero output. Registry-installed consumers therefore couldn't invoke the `substrate` bin script.
  - Fix: `clean` script now removes `tsconfig.tsbuildinfo` alongside `dist/` so `prepublishOnly` always produces a real build.
  - Verification: `npm pack --dry-run` lists `dist/cli.js` + `dist/index.js`; the 3.0.0-beta.3 tarball is 635 files (vs. 315 in the broken beta.2).
  - Both `3.0.0-beta.1` and `3.0.0-beta.2` should be deprecated on npm with a pointer at `3.0.0-beta.3`.

### Internal

- No source code changes vs `3.0.0-beta.2`. This release exists solely to ship a complete tarball with `dist/` present.

## [3.0.0-beta.2] — 2026-06-15

### Changed

- **README rewritten** to accurately reflect v3.0.0 surface. Previous published README was from v0.8 (three majors behind). New README leads with the headline capabilities (self-reinforcing proposal pipeline + org-shared content via `extends`), shows real install commands, lists actual v2 + v3 capabilities, documents the three AI editor bridges, and provides a status + roadmap table. No code changes vs `3.0.0-beta.1`.

## [3.0.0-beta.1] — 2026-06-15 — `extends`-awareness in consumer commands (NE-11 beta.1)

v3.0.0-beta.1 closes the gap surfaced by the v3.0.0-alpha.1 enterprise
smoke test: the `extends` primitive shipped in alpha.1 (discovery +
resolution + the merge wrappers) was correct, but the daily-driver
consumer commands (`run`, `audit`, `query`, `hooks list`) hadn't been
routed through the wrappers. Beta.1 closes that gap end-to-end so the
v3 headline value prop — "declare `extends` and the org's content is
just there" — actually works.

### Fixed — sub-phase A (HIGH bug #3)

- `substrate run <workflow>` now resolves workflows across the
  extends chain. A workflow declared only in an org-shared `file:`,
  `npm:`, or `github:` extends source executes directly from the
  consumer repo with zero copy-into-place ceremony. Before beta.1,
  `substrate run org-shared-workflow` returned "not found in
  substrate/workflows/. Discovered: (none)" even when the chain
  provided the workflow. Cross-cutting hooks fire from extends sources
  too.

### Fixed — sub-phase B (HIGH bug #4)

- `substrate audit` walks merged RULES.yaml across the extends chain.
  An org's RULES.yaml declared via `extends: [npm:@acme/shared]` (or
  any file/github source) is loaded automatically; repo-local rules
  with the same id override the org version. Adopters no longer need
  to copy the org's RULES.yaml into their repo to enforce org rules.
  `--rules-path` keeps its v1.0 single-file escape-hatch behavior.

### Fixed — sub-phase C (medium bugs #1 and #2)

- `substrate query rules` returns merged rules across the chain.
- `substrate query standards [--for-files <files>]` returns merged
  standards across the chain (repo-local-overrides-org by relative
  path, e.g. `backend/python.md`).
- `substrate query doc-checks [--for-files <files>]` returns merged
  doc-checks across the chain.
- `substrate hooks list` and `substrate hooks describe <id>` return
  merged hooks across the chain.

All four commands surface collision warnings ("rule X: repo-local
overrides Y") in the `warnings[]` array of their JSON output so CI
scripts can audit override behavior without re-walking the chain.

### Fixed — sub-phase D (low bugs #5 and #6)

- **Tarball CHANGELOG inclusion.** `@op4z/substrate@3.0.0-beta.1`
  ships with `CHANGELOG.md` inside the published tarball. The
  workspace-root CHANGELOG stays the canonical source; a `prepack`
  script (`scripts/copy-changelog.mjs`) stages it into the package
  directory before `npm pack` runs. Adopters now find the CHANGELOG
  in `node_modules/@op4z/substrate/CHANGELOG.md` without visiting
  the GitHub release page.
- **`extends clear-cache --json`** had been flagged as missing the
  `--json` flag in the alpha.1 smoke HANDOFF; verification showed the
  flag was already wired (this was a smoke handoff inaccuracy, not a
  code bug). Beta.1 smoke scenario 10f locks the JSON envelope shape
  (`{ removed, path, exitCode }`) as a regression gate.

### Added — sub-phase E (opt-out + slug docs)

- **`extends-opt-out: string[]`** on `substrate.config.json`. Each
  entry must match the exact `source` URL of an entry in `extends`;
  matching sources are suppressed from the resolved chain. Use case:
  a backend-only service repo opting out of org-shared frontend rules
  without forking the org package. Per-source warnings ("source
  suppressed by consumer config") make the suppression visible in
  `substrate extends list`. `substrate extends list --include-opt-out`
  bypasses the filter for diagnostics.
- **GitHub cache slug rules documented** with worked examples.
  The slug `<org>-<repo>@<sanitized-ref>` handles branch names with
  `/` (e.g. `feat/extends` → `feat_extends`), tags with special chars
  (`v1.0+build.5` → `v1.0_build.5`), and missing refs (slug ends in
  `@HEAD`). The cache manifest still records the source URL + resolved
  SHA so reproducibility is preserved.

### Tests

- `tests/v3-extends-consumers.test.ts` — 12 new tests covering the
  merge-wrapper plug-in for run/audit/query/hooks + the opt-out
  filter + bypass.
- 4 schema tests for `extends-opt-out` validation.
- 2 source-kind tests for cache slug edge cases.
- Smoke regression strengthened: scenarios 8, 9 no longer carry
  workarounds; scenario 10e (audit extends-awareness), 10f (tarball
  CHANGELOG + clear-cache JSON), 10g (opt-out + bypass) added.
- 13 → 16 enterprise smoke scenarios; 778 + 1 skipped baseline
  preserved at 795 + 1 skipped (17 new tests across all suites).

### Compatibility / migration

- **No breaking changes from v3.0.0-alpha.1.** v3-shaped consumers
  with `extends` configured see expanded behavior on the consumer
  commands; v2-shaped consumers (no `extends` field) see identical
  behavior to v2.x because the merge wrappers collapse to a
  single-layer chain.
- The `extends-opt-out` field is a pure additive — configs without it
  continue to validate.

## [3.0.0-alpha.1] — 2026-06-15 — `extends` primitive (NE-11)

v3.0-alpha.1 ships the **org-scoped content composition** primitive
that unlocks enterprise adoption — `extends` — as a single additive
layer over v2.0. A consumer's `substrate.config.json` can now declare
an upstream substrate-content source (npm package, github repo, or
local directory); the resolver walks each source's `substrate/` tree
and merges per-kind with locked-in "repo-local wins" collision
semantics. v2.0 consumers who don't add an `extends` field see zero
behavior change.

This is the only feature in 3.0; the rest of the v2.0 surface is
untouched. The major bump reflects that org-scoped composition adds a
new dimension to substrate's content model (consumer vs upstream)
that downstream tooling needs to be aware of.

### Added — sub-phase A (schema)

- `extends` array on `substrate.config.json` schema. Three source
  forms: `npm:<pkg>`, `github:<org>/<repo>[#ref]`, `file:<path>`.
  Pattern-validated; `additionalProperties: false` on each entry
  catches typos (e.g. `verison: "^2.0.0"`).
- `ExtendsSource` TypeScript type on `SubstrateConfig` (purely
  additive; optional field).
- `validateConfig` / `validateConfigFile` ajv-backed validator at
  `src/v2/extends/config-validator.ts`. v2.0 configs (no `extends`
  field) continue to validate.
- 23 schema tests covering all source forms, error cases, and the
  per-entry warning surface (`version` on a github source, etc.).

### Added — sub-phase B (resolver + layered discovery)

- `src/v2/extends/resolver.ts` — `resolveExtendsChain` returns the
  ordered layer chain (base → repo-local). Repo-local layer is always
  appended last so it overrides every extends source.
- `discoverWorkflowsAcrossExtends`, `discoverHooksAcrossExtends`,
  `discoverDocChecksAcrossExtends` — extends-aware discovery wrappers.
  Existing v2 single-root discoverers are untouched per plan §2.2.
- `discoverStandardsAcrossExtends`, `discoverRulesAcrossExtends` —
  standards + RULES.yaml merging across the chain. Standards collide
  on relative path; rules collide on rule id; both with "later wins."
- `MergedDiscoveryResult` provenance: every entry tags the source it
  came from (`{ source: "npm:@acme/substrate-shared" | "repo-local",
  manifestPath }`).
- 21 tests covering 5 collision scenarios + multi-source ordering in
  `tests/v3-extends-resolver.test.ts`.

### Added — sub-phase C (source kinds + caching)

- `file:` — live filesystem resolution against the consumer root.
  Rejects nonexistent paths + non-directory targets with actionable
  error messages.
- `npm:` — resolved via the consumer's `node_modules`. Walks up to
  parent workspace roots (so npm/yarn workspace hoists work).
- `github:` — shallow clone via `git clone --depth 1 --branch <ref>`
  into `substrate/.cache/extends/github/<org>-<repo>@<ref>/`. Falls
  back to full clone + checkout for SHA refs. Cache manifest at
  `<cache>/manifest.json` tracks each entry's resolved SHA + ref +
  fetch timestamp per plan §2.5.
- **Air-gap support.** `SUBSTRATE_OFFLINE=1` env var (or per-call
  override) refuses `git clone` calls. A warm cache continues to
  serve; a cold cache surfaces a `warning` and the chain continues
  without the source.
- `clearExtendsCache(consumerRoot)` + `refreshGithubSource(...)`
  helpers for CLI use.
- 21 source-kind tests in `tests/v3-extends-source-kinds.test.ts`
  with an injectable `gitRunner` so tests never hit the network.

### Added — sub-phase D (CLI surface)

- `substrate extends list [--json]` — print the resolved chain with
  per-layer contribution counts (workflows, hooks, doc-checks,
  standards, RULES rows), the effective merged registry, and any
  conflicts.
- `substrate extends sync [--source <id>]` — refresh `github:` caches
  by re-cloning at the pinned ref. `npm:` + `file:` sources are
  skipped (with documented reasons). Optional `--source` filter so
  only one entry is refreshed.
- `substrate extends clear-cache` — wipe
  `substrate/.cache/extends/`. No-op when the dir doesn't exist
  (exit 0).
- 11 CLI tests in `tests/v3-extends-cli.test.ts` covering text + JSON
  output shapes + exit codes.

### Added — sub-phase E (polish + release)

- Comprehensive integration test in `tests/v3-extends-integration.test.ts`
  that exercises npm + github + file sources together against a
  single consumer fixture, plus an explicit air-gap (`SUBSTRATE_OFFLINE=1`)
  scenario.
- `docs/architecture.md` documents the v3 extends layer.
- `package.json` version bumped to `3.0.0-alpha.1` (both
  workspace root and `packages/substrate/`).

### Compatibility / migration

- **Zero migration required for v2.0 consumers.** A consumer who
  upgrades to v3.0-alpha.1 and does not add an `extends` field sees
  identical behavior. The resolver's hot path returns immediately
  when the chain is empty.
- Existing 703-test v2.0 baseline still passes intact (plus the v3
  test suite for a total of 779+ passing + 1 skipped on this release).
- No new runtime dependencies. The github clone path shells out to
  the user's existing `git` binary; no `simple-git` or
  `isomorphic-git` added.

### Out of scope for 3.0-alpha.1 (deferred per plan §2)

- Transitive extends (an extends source that itself declares
  `extends`). Plan §2.2 explicitly defers to v3.1; `substrate doctor`
  will gain an `extends-transitive` warning in a follow-up release.
- `extends-mode: inherit` (per plan §2.4(a)) and
  `extends-mode: append` (per plan §2.4(b)) opt-outs. v3.0-alpha.1
  ships the locked "repo-local wins, log warning" semantics; the
  override modes land in a later 3.x release if real adoption signal
  asks for them.
- `substrate doctor --check extends-*` checks (per plan §2.10). Land
  in v3.0-beta.1.
- `substrate audit --explain <rule-id>` provenance line (per plan
  §2.4(b)). Land in v3.0-beta.1.

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
  `escalation-debt`, `ripgrep-lookaround`. Each addressable
  individually via `--check <name>`; aggregate run includes all of
  them. `--json` works on every form.
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

### Added — Targeted improvements (pre-publish)

These six items closed gaps identified during the v3 exploration
pass and folded into v2.0 itself (no separate v2.1 patch — v2.0 had
not yet published, so no consumer would break).

- **AI step engine — six step types run end-to-end** (TI-1). The
  orchestrator's `runStep` no longer returns `status: "deferred"`
  for `prompt` / `prompt-and-action` / `invoke-sub-workflow` /
  `gate` / `discover` / `propose-doc-change`. Each gets a real
  handler in `src/v2/orchestrator/step-handlers.ts`. New
  `OrchestrationTransport` interface (`transport.ts`) is the public
  extension point for AI surfaces (Claude Code, Cursor, MCP); the
  built-in no-op transport keeps the engine deterministic for
  tests / CI. Sub-workflow nesting capped at depth 5. The proposal
  pipeline now sees real `prompt-issued`, `step-confirm`, and
  `adhoc-step` events from sessions where they occur.
- **`session-start`, `session-end`, `file-change` hook triggers
  wired** (TI-2). HookTrigger declared these but no code path was
  firing them. Now: `session-start` fires once at the start of
  `substrate run` (before workflow-start); `session-end` mirrors at
  the end (after workflow-completion). `file-change` fires from a
  new `substrate watch [path]` long-running watcher (uses
  `node:fs.watch` recursively — Node 20+; no external dep).
  Debounces at 100ms; ignores `substrate/sessions/`,
  `substrate/proposals/`, `.git/`, `node_modules/`, `dist/` to
  avoid feedback loops.
- **`substrate explain <workflow-id>`** (TI-3). The missing
  inspection primitive. Loads context exactly as `substrate run`
  would, then prints the resolved manifest + each step's prompt
  summary — without running anything. `--for-files` supports
  `intersect-with-changed-files` memory filters. `--json` emits a
  structured envelope.
- **`substrate scheduler --auto-run`** (TI-5). Complement to the
  read-only `--check`. Fires every overdue scheduled workflow (or
  `--workflow <id>` for one). State updates via the orchestrator's
  existing `recordWorkflowRun` path; subsequent `--check` shows no
  overdue. Failures in one workflow don't crash the loop.
- **Five additional reference workflows** (TI-6): `git-review-pre`,
  `git-review-deep`, `commit-and-push`, `standards-update`,
  `audit-security`. Each ships manifest + body.md and demonstrates a
  specific v2 capability (composition, sub-workflows,
  prompt-and-action with must-confirm, propose-doc-change, scheduled
  triggers). `substrate init` now copies them all.

### Fixed — Targeted improvements

- **Ripgrep look-around regexes in shipped RULES** (TI-4). Three
  rules used negative-lookahead / multi-line syntax that ripgrep
  silently drops without `--pcre2`. All three rewritten as `type:
  script` detectors with companion `.mjs` files under
  `templates/standards/cross-cutting/detectors/`. New doctor check
  `ripgrep-lookaround` warns when consumer RULES.yaml contains
  look-around patterns. `substrate init` now copies the script
  detectors so a fresh init has working rules out of the box.

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
- See "Fixed — Targeted improvements" above for the TI-4
  ripgrep look-around fix.

#### Pre-publish cleanup (OP-1374, 2026-05-15)

- `new-service.yaml` reference template now ships with a `body.md`
  (was triggering `substrate doctor` warnings on every consumer).
  Rewritten as a generic scaffolding workflow that points at the
  user's `substrate.config.json` for stack hints rather than
  hard-coding the OP4Z FastAPI pattern, and joined the reference
  workflow set.
- Memory loader now skips `MEMORY.md`, `README.md`, `INDEX.md` by
  default (Claude Code's index / readme conventions). The previous
  loader treated them as memories needing frontmatter, generating a
  spurious "missing frontmatter" doctor warning on every consumer.
  Configurable per-repo via `substrate.config.json` `memory.ignore`
  (additive on top of the defaults).
- `auto/.substrate-manifest.json` now correctly populates `entries`
  when `substrate init` scaffolds files. Previously the file was
  left as `entries: []` despite init writing ~50 files, breaking
  `substrate uninstall`'s precise-removal path (it had to fall back
  to the known-location pattern). Every init-scaffolded file is now
  recorded with `sha256:` content hash + template version + repo-
  relative path.
- `BE-APIV-001` script detector now recognises FastAPI's
  router-include prefix pattern. The v2.0.0 detector only
  understood decorator-level `/api/v1` prefixes
  (`@app.get("/api/v1/users")`) and missed the far more common
  `include_router(..., prefix="/api/v1")` shape, producing 535
  false positives on OP4Z. Two-pass walk: pass 1 maps router
  variables to their include-time prefixes; pass 2 walks decorators
  and flags only routes whose effective path
  (`prefix + decorator-path`) doesn't start with `/api/vN`.

### Test count

- v1.0 baseline: 305+ tests.
- v2.0: 703 passed + 1 skipped across 66 test files (substrate +
  adapters). Phase deltas:
  - B1: discoverer + context-loader + query + run
  - B2: +141 (hooks, doc-checks, memory, composition, escalation)
  - B3: +127 (session-log, drift detectors, classifier, queue,
    pipeline-e2e, yaml-edit, applicators, review, scheduler,
    doctor-memory)
  - B4: +35 (doctor v2 checks, query sessions, knowledge sources)
  - TI: +60 (step engine + lifecycle hooks + watch + explain +
    auto-run + ripgrep lookaround + new reference workflows)
  - OP-1374 cleanup: +12 (new-service body.md, memory ignore list,
    init manifest population, BE-APIV-001 router-include pattern)

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
