# Cadence

> Repeatable automation patterns for codebases. Audits, scaffolds, standards, workflows, and AI-editor bridges — scaffolded into your repo where you own them.

**Status:** v0.5 (upgrade + extensibility). Local development only; not yet published to npm.

Cadence is the public extraction of a `./exc + /run` automation system
that grew up inside a private monorepo. It separates the **framework**
(versioned, lives in `node_modules/cadence`) from the **opinionated
content** (audit playbooks, standards, scaffolds — scaffolded into
your repo where you can edit them). Same model that made shadcn/ui
click: install once, own forever.

---

## What ships in v0.5

v0.5 is the **upgrade + extensibility** milestone. v0.3's content layer
(15 audits, 21 standards, stack auto-detection, knowledge auto-discovery)
is intact; v0.5 layers on:

| Capability (additions in v0.5)                                                       | Status |
| ----------------------------------------------------------------------------------- | ------ |
| `cadence upgrade --check / --apply / --dry-run` — diff & merge scaffolded files     | new    |
| Three-way merge UX: keep / take-new / merge / eject per modified file               | new    |
| Plugin contract for **task adapters** (TaskAdapter) + `cadence task` CLI verbs      | new    |
| Reference stub task adapter at `packages/adapter-stub/`                             | new    |
| Plugin contract for **VCS adapters** (VcsAdapter) + built-in git adapter            | new    |
| `cadence workflow list / describe / start <id> --var k=v` runtime                   | new    |
| Default `new-service` workflow shipped as a bundled template                        | new    |
| Three step types in workflows: `command`, `audit`, `prompt`                         | new    |
| Cursor bridge alongside Claude bridge — both coexist freely                         | new    |
| `cadence init --bridge claude,cursor` — multi-bridge scaffold                       | new    |
| YAML parser swap to `yaml` (eemeli) — full spec support, fixes `command: >` truncation | new |

Carried over from v0.3 (unchanged):

| Capability                                                                          | Status |
| ----------------------------------------------------------------------------------- | ------ |
| `cadence init` — scaffold `auto/`, `cadence.config.json`, manifest stub             | yes    |
| Stack auto-detection (Python / TypeScript / Go / Rust)                              | yes    |
| 15-audit catalog scaffold-able via `cadence add audit <name>`                       | yes    |
| 21 standards docs scaffold-able via `cadence add standard <scope/area>`             | yes    |
| `cadence add scaffold|command|workflow` — incremental item scaffolding              | yes    |
| `auto/.cadence-manifest.json` tracks every scaffold (sha256 + template version)     | yes    |
| `cadence audit --list` / `--type <name>` (instruction-file aware stub)              | yes    |
| `cadence create --template <name> --name <foo>` — scaffold a package                | yes    |
| `cadence knowledge refresh / show [--section <name>]`                               | yes    |
| `cadence doctor` — diagnostic command (config, manifest, stack, bridge)             | yes    |
| Test suite — **194 tests** across 22 files (unit + integration); lint+tsc+build green | yes |

**Explicitly NOT in v0.5.** See the [roadmap](#roadmap) for when each
arrives. Calling a still-deferred command (`review`, `standards`,
`config`) exits with code 2 and a hint.

---

## Install

v0.5 is local-only — no npm publish yet. To try it inside this repo:

```bash
git clone <this-repo>
cd cadence
npm install
npm run build
node dist/cli.js --help
```

To use it inside another local project, `npm link`:

```bash
cd cadence && npm link
cd /path/to/your/project
npm link cadence
cadence init
```

---

## Quick tour

```bash
# 1. Scaffold the auto/ tree, config, and (optionally) AI-editor bridges
cadence init --bridge claude,cursor

# 2. Cadence auto-detects your stack from pyproject.toml, package.json, etc.,
#    and pre-enables the appropriate audits + standards. Inspect the config:
cat cadence.config.json | jq '.defaults'

# 3. Add additional audits as you need them
cadence add audit security
cadence add audit performance
cadence add audit api-contract

# 4. Add standards docs to your repo
cadence add standard backend/architecture
cadence add standard frontend/react

# 5. Auto-discover your local stack from docker-compose
cadence knowledge refresh
cadence knowledge show --section services

# 6. Register and run a workflow
cadence add workflow new-service
cadence workflow list
cadence workflow describe new-service
cadence workflow start new-service --var SERVICE_NAME=billing

# 7. Inspect drift between your edits and current templates
cadence upgrade --check

# 8. Verify the install is healthy
cadence doctor
```

---

## Commands

### `cadence init`

Scaffold the `auto/` directory, root config, and (optionally) one or
more AI-editor bridge files.

```bash
cadence init                                  # auto-detect stack from markers
cadence init --name my-app --short-code MA
cadence init --bridge claude                  # scaffold .claude/commands/cadence.md
cadence init --bridge cursor                  # scaffold .cursor/commands/cadence.md
cadence init --bridge claude,cursor           # both (they coexist freely)
cadence init --with-claude                    # legacy alias for --bridge claude
cadence init --stack python                   # explicit stack override
```

**Stack auto-detection.** Cadence looks for marker files at the repo
root and pre-enables appropriate defaults:

| Stack      | Markers (any one)                                              |
| ---------- | -------------------------------------------------------------- |
| python     | `pyproject.toml`, `poetry.lock`, `requirements.txt`, `setup.py` |
| typescript | `package.json`, `tsconfig.json`                                |
| go         | `go.mod`                                                       |
| rust       | `Cargo.toml`                                                   |

Multiple matches → all are recorded, and the audit / standards set is
the union for the detected stacks. Pass `--stack <a>,<b>` to override.

After running, your repo gains:

```
auto/
├── commands/                # your slash-command surface
├── instructions/main/       # audit playbooks (yours to edit)
│   ├── audit-pre-merge.md
│   ├── audit-dependencies.md
│   └── audit-dead-code.md
├── scripts/                 # local scripts
├── config/                  # project + scaffolds + workflows registries
├── standards/               # standards docs (added via `cadence add standard`)
├── audits/                  # audit report output
├── docs/                    # decisions + KNOWLEDGE.md (generated)
└── .cadence-manifest.json   # tracked-scaffolds manifest
cadence.config.json
.claude/commands/cadence.md  # only with --with-claude
```

### `cadence add <category> <item>`

Single-item scaffolding parallel to `shadcn add`. Each invocation
updates `auto/.cadence-manifest.json` with the template version + a
SHA-256 of the scaffolded contents so the v0.5 upgrade flow can diff
your edits against future template releases.

```bash
cadence add audit backend
cadence add audit security
cadence add standard backend/architecture
cadence add standard frontend/react
cadence add scaffold package-ts
cadence add command audit
cadence add workflow new-service
```

Existing files are preserved by default (shadcn-style). Pass
`--overwrite` to replace.

#### Audit catalog (15 audits)

| Audit                  | What it covers                                                |
| ---------------------- | ------------------------------------------------------------- |
| `pre-merge`            | Fast diff-only PR gate                                        |
| `dependencies`         | Outdated, CVEs, licenses, abandoned, lockfile drift           |
| `dead-code`            | Unreachable code, unused exports, orphan files                |
| `backend`              | Service layering, async hygiene, error handling, observability |
| `frontend`             | Component patterns, hooks, accessibility, data layer          |
| `package`              | Shared-package exports, deps, tests, README                   |
| `security`             | SAST + secret scanning + CVEs + isolation patterns            |
| `service-consistency`  | Pattern drift across services in the same repo                |
| `reusability`          | Duplicated logic that should be a shared package              |
| `extensibility`        | Magic numbers, hardcoded paths, closed-for-extension hotspots |
| `performance`          | N+1 queries, missing indices, render thrash, bundle bloat     |
| `api-contract`         | Endpoint diffs, breaking changes, schema drift                |
| `functionality-gaps`   | TODO density, untested critical paths, flag rot               |
| `trend`                | Score-over-time aggregator across audit sidecars              |
| `all`                  | Composite sweep — runs every enabled audit, rolls up findings |

Run `cadence add audit <name>` to add one. The default set (per detected
stack) is recorded in `cadence.config.json` → `defaults.audits`.

#### Standards catalog (21 docs)

| Scope          | Areas                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| backend (8)    | architecture, api, database, error-handling, observability, python, security, testing   |
| frontend (7)   | react, typescript, accessibility, performance, testing, data-management, logging         |
| infrastructure (2) | ci-cd, docker                                                                       |
| operations (2) | runbooks, feature-flags                                                                 |
| cross-cutting (2) | `RULES.yaml` (15-rule universal skeleton), `markdown-format-specification`           |

Each ships with frontmatter (scope, area, rule cross-references) and a
TODO-stub body (~40-100 lines). The *shape* ships; the *depth* comes
per-team as you fill in the TODOs.

### `cadence audit`

```bash
cadence audit --list                      # enumerate scaffolded audits
cadence audit --type pre-merge            # load instruction + stub report
cadence audit --type security --json      # machine-readable for CI
```

In v0.5 `--type <name>` still emits a stub. The detector runtime (rule
execution, score aggregation) ships in v0.8. The contract (where
instructions live, what front matter they carry) is stable now so AI
assistants and CI integrations can lean on it today.

### `cadence create --template <name> --name <foo>`

Scaffold a new package or service from a bundled template.

```bash
cadence create --template package-ts --name my-utils
cadence create --template package-python --name my_pylib
```

Available templates: `package-ts`, `package-python`. Path placeholders
(`{{NAME_SNAKE}}`, `{{NAME_PASCAL}}`) are substituted at copy time.

### `cadence knowledge`

Auto-discover the local-stack reference from `docker-compose.yml` and
`.env.example`. Writes `auto/docs/KNOWLEDGE.md`.

```bash
cadence knowledge refresh
cadence knowledge show
cadence knowledge show --section services
cadence knowledge show --section "environment variables"
```

Values matching the configured redact patterns (default: any key
containing `PASSWORD`, `TOKEN`, `SECRET`, `KEY` — case-insensitive)
are masked as `***REDACTED***` in the generated doc. Configure in
`cadence.config.json`:

```jsonc
{
  "knowledge": {
    "sources": ["docker-compose.yml", ".env.example"],
    "redactPatterns": ["PASSWORD", "TOKEN", "SECRET", "KEY"]
  }
}
```

### `cadence doctor`

Diagnose the cadence installation in the current repo. Reports on:

- Node runtime
- `cadence.config.json` presence + validity
- `auto/` directory structure
- Manifest entries (flags dangling entries that point at missing files)
- Stack alignment (declared vs detected)
- Claude bridge file (when enabled in config)
- Cursor bridge file (when enabled in config)

Exits 0 clean, non-zero with triage on error. Pass `--json` for
machine-readable output.

```bash
cadence doctor
cadence doctor --json | jq '.summary'
```

### `cadence upgrade`

Diff every scaffolded file against the bundled template at the
*current* cadence version, then either auto-update unmodified files or
walk the user through a three-way merge for each edited file.

```bash
cadence upgrade --check        # report drift; no writes
cadence upgrade --dry-run      # alias for --check
cadence upgrade --apply        # interactive; per-file resolution
```

State machine per tracked file (from `auto/.cadence-manifest.json`):

| State           | Trigger                                          | What `--apply` does                          |
| --------------- | ------------------------------------------------ | -------------------------------------------- |
| `unmodified`    | on-disk sha256 matches the manifest hash          | Auto-write the new template; refresh hash    |
| `modified`      | hash differs (user edited)                        | Prompt: **keep / take-new / merge / eject**  |
| `missing`       | manifest tracks a file that's been deleted        | Skip                                         |
| `ejected`       | manifest entry's `ejected: true`                  | Skip (permanently opted out)                 |
| `template-gone` | bundled template was renamed/removed              | Skip (warn — no template to upgrade against) |

The four interactive choices for a modified file:

- **keep** — leave the user's copy unchanged; refresh the manifest hash so the next upgrade run doesn't re-prompt.
- **take-new** — overwrite with the new template; refresh hash + version.
- **merge** — write `<file>.cadence-merge` beside the user's copy with the new template content; user resolves manually.
- **eject** — flip `ejected: true` in the manifest; future upgrades skip this file.

Note for v0.5: the diff shown is `user-current vs new-template`. The "original at recorded templateVersion" anchor requires a templates-history shipping path that lands in v0.8. The manifest schema is already keyed on `templateVersion`, so the third anchor can be layered in without a migration.

### `cadence workflow`

Multi-step automation runtime. Workflows are YAML manifests in
`auto/config/workflows.yaml`; cadence ships a default `new-service`
workflow that demonstrates all three step types.

```bash
cadence workflow list
cadence workflow describe new-service
cadence workflow start new-service --var SERVICE_NAME=billing
```

Three step types (locked schema for v0.5):

- **command** — shell command (spawned with `shell: true`, stdio inherited).
- **audit** — invokes `cadence audit --type <name>` in-process.
- **prompt** — asks the user via `@inquirer/prompts` and stores the answer in the variable bag.

Variable substitution: `${NAME}` tokens are replaced with values from `--var` and from prompt-step answers. In `command` strings, unknown vars are left as-is (the spawned shell sees them literally — typos surface loudly). In `condition` strings, unknown vars resolve to empty (so `condition: "${FLAG}"` is truthy only when the flag is set).

Example workflow:

```yaml
workflows:
  - id: new-service
    name: New Service Scaffold
    description: Scaffold a new backend microservice, then audit it
    steps:
      - name: Ask for service name
        type: prompt
        prompt: "What's the service name?"
        var: SERVICE_NAME
      - name: Scaffold
        type: command
        command: "cadence create --template service-fastapi --name ${SERVICE_NAME}"
      - name: Audit
        type: audit
        audit: backend
        condition: "${SERVICE_NAME}"
```

### `cadence task` (adapter-driven)

Cadence ships a neutral task-verb surface backed by a pluggable adapter
contract. Set `extensions.taskAdapter` in `cadence.config.json` to an
npm package implementing `TaskAdapter` (see `src/extensions/task-adapter.ts`);
the verbs route through it. When no adapter is configured, the verbs
exit non-zero with an install hint.

```bash
cadence task find OP-660
cadence task search "auth refresh" --limit 10
cadence task create --title "Fix x" --description "..." --priority high --hours 3
cadence task update OP-660 --status in_progress
cadence task complete OP-660 --actual-hours 2.5
```

Reference adapter ships in this repo at `packages/adapter-stub/`. It
logs every verb invocation (`[stub-adapter] would call <verb>`) and
returns synthetic tasks — useful for testing the plugin contract or
copying as a starting point for a real adapter.

To wire a real adapter: build it as an npm package whose default export
satisfies `TaskAdapter`, install it, and point the config field at the
package name. Cadence loads it lazily via dynamic `import()` at runtime.

### VCS adapter (default: built-in git)

The same plugin pattern applies to VCS. `extensions.vcsAdapter` either
points at a package implementing `VcsAdapter` or stays null — in which
case cadence uses the built-in git adapter (`src/adapters/git.ts`),
which shells out to the `git` binary. Future SCM adapters (Mercurial,
Pijul) drop into the same slot.

---

## Configuration

`cadence init` writes `cadence.config.json` at your repo root. v0.5's
shape:

```jsonc
{
  "$schema": "https://cadence.dev/schema.json",
  "version": "0.5.0",
  "project": { "name": "my-app", "shortCode": "MA" },
  "stacks": ["python", "typescript"],
  "paths": { /* repo layout */ },
  "defaults": {
    "audits":    [ /* derived from detected stacks */ ],
    "standards": [ /* derived from detected stacks */ ],
    "scaffolds": ["package-ts", "package-python"],
    "workflows": []
  },
  "bridges": {
    "claude": { "enabled": true,  "commandsDir": ".claude/commands" },
    "cursor": { "enabled": false, "commandsDir": ".cursor/commands" }
  },
  "knowledge": {
    "sources": ["docker-compose.yml", ".env.example"],
    "redactPatterns": ["PASSWORD", "TOKEN", "SECRET", "KEY"]
  },
  "extensions": {
    "taskAdapter": null,   // null → `cadence task` exits with install hint
    "vcsAdapter":  null    // null → fall back to built-in git adapter
  },
  "telemetry": { "enabled": false }
}
```

The schema is documented inline in `src/util/types.ts`.

---

## Architecture

Two-layer separation — the core design decision:

```
node_modules/cadence/      (framework — versioned, upgrades freely)
├── bin/cadence            CLI entry point (commander)
├── dist/                  compiled source
│   ├── adapters/git.js    built-in VCS adapter (shell-out to git)
│   ├── extensions/        plugin contracts (TaskAdapter, VcsAdapter, loader)
│   └── ...
└── templates/             source-of-truth defaults (copied on init / add)
    ├── init/              scaffolded by `cadence init`
    ├── audits/            consumed by `cadence add audit <name>`
    ├── standards/         consumed by `cadence add standard <scope>/<area>`
    ├── bridges/
    │   ├── claude/        Claude Code slash-command file
    │   └── cursor/        Cursor slash-command file (v0.5)
    ├── workflows/         bundled workflow definitions (e.g. new-service)
    ├── package-ts/        consumed by `cadence create --template package-ts`
    └── package-python/    consumed by `cadence create --template package-python`

packages/adapter-stub/     (in-repo reference TaskAdapter — copy-paste starting point)

<your repo>/               (scaffolded — owned by you, lives in git)
├── auto/
│   ├── instructions/main/ audit playbooks (editable)
│   ├── standards/         standards docs (editable)
│   ├── config/            scaffolds.yaml + workflows.yaml registries
│   ├── docs/              KNOWLEDGE.md + ADRs
│   └── .cadence-manifest.json
├── cadence.config.json    root config (incl. extensions.taskAdapter / vcsAdapter)
├── .claude/commands/      slash-command bridge (opt-in)
└── .cursor/commands/      slash-command bridge (opt-in)
```

The framework knows where to look; you own what's there. Same model
as shadcn/ui: install once, own forever.

---

## Roadmap

Cadence is being built in phases. v0.5 ships the upgrade flow,
extensibility contracts, the workflow runtime, and the second bridge.
Later versions add the detector runtime, MCP support, and the
reference-adapter ecosystem.

| Version | Theme                                | Headline additions                                                                                                   |
| ------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| v0.1    | Skeleton                             | `init`, `audit --list/--type`, `create`. Three audit templates. Two scaffold templates.                              |
| v0.3    | Content layer                        | `add`, `knowledge`, `doctor`. 15-audit catalog. 21 standards docs. Stack auto-detection.                             |
| v0.5    | **Upgrade + extensibility (current)** | `upgrade` (three-way merge). `task` + `workflow` runtimes. Task/VCS plugin contracts. Cursor bridge. YAML lib swap.  |
| v0.8    | Hardening + ecosystem                | MCP server bridge. GitHub Action. Detector runtime (RULES execution). Telemetry first ship (opt-in). Reference adapters (Linear/Jira/GH Issues). |
| v1.0    | GA                                   | Semver freeze on `cadence.config`. Public RULES registry contribution mechanism. Migration guide from 0.x.           |

### What's deliberately deferred beyond v0.5

- **Detector runtime** — `audit --type` still emits a stub. The actual
  ripgrep / vulture / pip-audit wrappers ship in v0.8 alongside the
  RULES.yaml execution engine.
- **`cadence review`** — wraps `audit --type pre-merge` with the
  variants (pre, standards, security, deep, doc-gap). v0.8.
- **`cadence standards init/list/for-files`** — once the standards
  bodies are filled in by real projects. v0.8.
- **`cadence config`** — view / enable / disable / eject items from
  `cadence.config.json`. v0.8 (today users edit JSON directly; `upgrade --apply`
  exercises the eject path).
- **MCP server bridge** — a third bridge target alongside claude/cursor. v0.8.
- **Reference adapters** — `@cadence/adapter-linear`, `@cadence/adapter-jira`,
  `@cadence/adapter-github-issues`. The contract is locked in v0.5; the
  reference implementations ship in v0.8. The stub at `packages/adapter-stub/`
  is enough to prove the contract today.
- **Three-way merge with real `original` anchor** — v0.5 ships the
  upgrade flow with a `current vs new-template` diff. The third anchor
  (original template at the recorded `templateVersion`) needs a
  `templates-history/` shipping path; v0.8.
- **Telemetry** — opt-in, off by default. v0.8 first ships the prompt.
- **npm publish** — still local-only. v0.8.

---

## Project conventions

- TypeScript with ESM, Node 20+, strict mode on.
- CLI via `commander`. No Handlebars — placeholder substitution is
  plain `String.split().join()`.
- Vitest 4 for unit tests; ESLint + Prettier for static checks.
- All commands have a programmatic entry point (`runInit`,
  `runAuditList`, `runAdd`, `runKnowledgeRefresh`, `runDoctor`, etc.)
  so they can be invoked from JS without spawning a subprocess. The
  CLI is a thin dispatch layer.

---

## Development

```bash
npm install
npm run build       # tsc -b
npm run lint        # eslint
npm test            # vitest run (full suite — unit + integration)
npm run typecheck   # tsc --noEmit
npm run format      # prettier --write
```

### Testing

Cadence ships two test layers, both run by the default `npm test`:

| Layer | Location | What it covers | How it runs |
| ----- | -------- | -------------- | ----------- |
| **Unit** | `tests/*.test.ts` | Programmatic API surface — calls `runInit`, `runAdd`, etc. directly. Fast (~0.3s for the whole layer). | `npm run test:unit` |
| **Integration** | `tests/integration/*.test.ts` | Spawns the built CLI (`dist/cli.js`) as a Node subprocess against a fresh tmp dir per test. Catches bugs the unit layer structurally can't — the v0.3 symlink bug (`3995a60`) is the canonical example: 84 unit tests passed cleanly while `cadence --help` silently no-op'd on the global-bin install path. | `npm run test:integration` |

The integration suite rebuilds `dist/` automatically before any spec runs (via vitest's `globalSetup`), so it's always testing the current source. Each spec maps directly to a smoke-test step in `.agent/SMOKE-2026-05-14.md` — adding a new CLI surface in future milestones means adding both a unit test for the programmatic API and an integration spec for the spawned-binary contract.

End-to-end manual smoke test (still useful when wiring up new commands):

```bash
mkdir -p /tmp/cadence-smoke && cd /tmp/cadence-smoke

# Mark this as a TypeScript repo so auto-detection has something to find
echo '{}' > package.json

CAD=/path/to/cadence/dist/cli.js
node $CAD init --name smoke --bridge claude,cursor
node $CAD add audit security
node $CAD add standard frontend/react
node $CAD add workflow new-service
node $CAD workflow list
node $CAD workflow describe new-service
node $CAD upgrade --check
node $CAD doctor
```

---

## License

MIT — see [LICENSE](./LICENSE).
