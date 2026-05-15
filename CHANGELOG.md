# Substrate — CHANGELOG

All notable changes to the substrate CLI are documented in this file.
Adheres roughly to [Keep a Changelog](https://keepachangelog.com).

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

[1.0.0]: https://github.com/op4z/substrate/releases/tag/v1.0.0
[0.8.0]: https://github.com/op4z/substrate/releases/tag/v0.8.0
[0.5.0]: https://github.com/op4z/substrate/releases/tag/v0.5.0
[0.3.0]: https://github.com/op4z/substrate/releases/tag/v0.3.0
[0.1.0]: https://github.com/op4z/substrate/releases/tag/v0.1.0
