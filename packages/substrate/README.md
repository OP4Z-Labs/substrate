# Substrate

> Repeatable automation patterns for codebases. Audits, scaffolds, standards, workflows, and AI-editor bridges — scaffolded into your repo where you own them.

**Status:** v0.8 (hardening + ecosystem). Local development only; not yet published to npm.

Substrate is the public extraction of a `./exc + /run` automation system
that grew up inside a private monorepo. It separates the **framework**
(versioned, lives in `node_modules/@op4z/substrate`) from the **opinionated
content** (audit playbooks, standards, scaffolds — scaffolded into
your repo where you can edit them). Same model that made shadcn/ui
click: install once, own forever.

---

## What ships in v0.8

v0.8 is the **hardening + ecosystem** milestone. v0.5's plugin
contracts and three-way upgrade flow are intact; v0.8 layers on:

| Capability (additions in v0.8)                                                       | Status |
| ----------------------------------------------------------------------------------- | ------ |
| `templates-history/<version>/` shipping path — real three-way merge anchors        | new    |
| Monorepo migration — main CLI moves to `packages/substrate/`; npm workspaces at root | new    |
| MCP server bridge (`substrate mcp serve`) — third bridge alongside Claude + Cursor   | new    |
| `substrate init --bridge mcp` scaffolds Claude-Desktop-compatible MCP registration   | new    |
| GitHub Action wrapper (`action.yml` + `dist/action/index.js`) for CI usage          | new    |
| Three reference adapters: `@op4z/substrate-adapter-{linear,jira,github}` (workspace pkgs) | new    |
| Astro docs site (`docs-site/`) dogfooded with substrate; builds via `docs:build`      | new    |
| Opt-in telemetry: `substrate config --telemetry on|off`, local-log emission         | new    |
| `substrate config --telemetry` CLI command surface                                    | new    |

v0.5 capabilities (unchanged):

| Capability (carried from v0.5)                                                       | Status |
| ----------------------------------------------------------------------------------- | ------ |
| `substrate upgrade --check / --apply / --dry-run` — diff & merge scaffolded files     | yes    |
| Three-way merge UX: keep / take-new / merge / eject per modified file               | yes    |
| Plugin contract for **task adapters** (TaskAdapter) + `substrate task` CLI verbs      | yes    |
| Plugin contract for **VCS adapters** (VcsAdapter) + built-in git adapter            | yes    |
| `substrate workflow list / describe / start <id> --var k=v` runtime                   | yes    |
| Default `new-service` workflow shipped as a bundled template                        | yes    |
| Three step types in workflows: `command`, `audit`, `prompt`                         | yes    |
| Cursor bridge alongside Claude bridge — both coexist freely                         | yes    |
| `substrate init --bridge claude,cursor` — multi-bridge scaffold                       | yes    |
| YAML parser swap to `yaml` (eemeli) — full spec support                            | yes    |

Carried over from v0.3 (unchanged):

| Capability                                                                          | Status |
| ----------------------------------------------------------------------------------- | ------ |
| `substrate init` — scaffold `auto/`, `substrate.config.json`, manifest stub             | yes    |
| Stack auto-detection (Python / TypeScript / Go / Rust)                              | yes    |
| 15-audit catalog scaffold-able via `substrate add audit <name>`                       | yes    |
| 21 standards docs scaffold-able via `substrate add standard <scope/area>`             | yes    |
| `substrate add scaffold|command|workflow` — incremental item scaffolding              | yes    |
| `auto/.substrate-manifest.json` tracks every scaffold (sha256 + template version)     | yes    |
| `substrate audit --list` / `--type <name>` (instruction-file aware stub)              | yes    |
| `substrate create --template <name> --name <foo>` — scaffold a package                | yes    |
| `substrate knowledge refresh / show [--section <name>]`                               | yes    |
| `substrate doctor` — diagnostic command (config, manifest, stack, bridge)             | yes    |
| Test suite — **272 tests** across 31 files (unit + integration); lint+tsc+build green | yes |

**Explicitly NOT in v0.8.** See the [roadmap](#roadmap) for when each
arrives. Calling a still-deferred command (`review`, `standards`)
exits with code 2 and a hint. The `config` command now ships with
`--telemetry` only; `--enable / --disable / --eject` follow in v1.0.

---

## Install

v0.8 is local-only — no npm publish yet. The monorepo layout (v0.8
landed npm workspaces with the main CLI at `packages/substrate/`):

```
substrate/             ← monorepo root
├── packages/
│   ├── substrate/             ← the main CLI (publishable as `@op4z/substrate`)
│   ├── adapter-stub/                 ← reference TaskAdapter (logs verbs)
│   ├── adapter-linear/               ← @op4z/substrate-adapter-linear
│   ├── adapter-jira/                 ← @op4z/substrate-adapter-jira
│   └── adapter-github/               ← @op4z/substrate-adapter-github
├── docs-site/                        ← Astro docs site (substrate-dogfooded)
├── action.yml                        ← GitHub Action entrypoint
├── dist/action/index.js              ← Action JS (checked in for `uses:` consumers)
└── package.json                      ← workspace manager
```

To try it inside this repo:

```bash
git clone <this-repo>
cd substrate
npm install                           # installs across all workspaces
npm run build                         # builds substrate + adapter-stub + adapters
node packages/substrate/dist/cli.js --help
```

To use it inside another local project, `npm link`:

```bash
cd substrate/packages/substrate && npm link
cd /path/to/your/project
npm link substrate
substrate init
```

### Using a reference adapter

```bash
cd /path/to/your/project
# In your substrate.config.json:
#   "extensions": { "taskAdapter": "@op4z/substrate-adapter-linear" }

# Link the adapter locally (until npm publish lands in v1.0):
cd /path/to/substrate/packages/adapter-linear && npm link
cd /path/to/your/project
npm link @op4z/substrate-adapter-linear

export LINEAR_API_KEY=lin_api_xxx
substrate task find ENG-123
```

Each adapter has its own README under `packages/adapter-<name>/README.md`.

---

## Quick tour

```bash
# 1. Scaffold the auto/ tree, config, and (optionally) AI-editor bridges
substrate init --bridge claude,cursor

# 2. Substrate auto-detects your stack from pyproject.toml, package.json, etc.,
#    and pre-enables the appropriate audits + standards. Inspect the config:
cat substrate.config.json | jq '.defaults'

# 3. Add additional audits as you need them
substrate add audit security
substrate add audit performance
substrate add audit api-contract

# 4. Add standards docs to your repo
substrate add standard backend/architecture
substrate add standard frontend/react

# 5. Auto-discover your local stack from docker-compose
substrate knowledge refresh
substrate knowledge show --section services

# 6. Register and run a workflow
substrate add workflow new-service
substrate workflow list
substrate workflow describe new-service
substrate workflow start new-service --var SERVICE_NAME=billing

# 7. Inspect drift between your edits and current templates
substrate upgrade --check

# 8. Verify the install is healthy
substrate doctor
```

---

## Commands

### `substrate init`

Scaffold the `auto/` directory, root config, and (optionally) one or
more AI-editor bridge files.

```bash
substrate init                                  # auto-detect stack from markers
substrate init --name my-app --short-code MA
substrate init --bridge claude                  # scaffold .claude/commands/substrate.md
substrate init --bridge cursor                  # scaffold .cursor/commands/substrate.md
substrate init --bridge claude,cursor           # both (they coexist freely)
substrate init --with-claude                    # legacy alias for --bridge claude
substrate init --stack python                   # explicit stack override
```

**Stack auto-detection.** Substrate looks for marker files at the repo
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
├── standards/               # standards docs (added via `substrate add standard`)
├── audits/                  # audit report output
├── docs/                    # decisions + KNOWLEDGE.md (generated)
└── .substrate-manifest.json   # tracked-scaffolds manifest
substrate.config.json
.claude/commands/substrate.md  # only with --with-claude
```

### `substrate add <category> <item>`

Single-item scaffolding parallel to `shadcn add`. Each invocation
updates `auto/.substrate-manifest.json` with the template version + a
SHA-256 of the scaffolded contents so the v0.5 upgrade flow can diff
your edits against future template releases.

```bash
substrate add audit backend
substrate add audit security
substrate add standard backend/architecture
substrate add standard frontend/react
substrate add scaffold package-ts
substrate add command audit
substrate add workflow new-service
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

Run `substrate add audit <name>` to add one. The default set (per detected
stack) is recorded in `substrate.config.json` → `defaults.audits`.

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

### `substrate audit`

```bash
substrate audit --list                      # enumerate scaffolded audits
substrate audit --type pre-merge            # load instruction + stub report
substrate audit --type security --json      # machine-readable for CI
```

In v0.5 `--type <name>` still emits a stub. The detector runtime (rule
execution, score aggregation) ships in v0.8. The contract (where
instructions live, what front matter they carry) is stable now so AI
assistants and CI integrations can lean on it today.

### `substrate create --template <name> --name <foo>`

Scaffold a new package or service from a bundled template.

```bash
substrate create --template package-ts --name my-utils
substrate create --template package-python --name my_pylib
```

Available templates: `package-ts`, `package-python`. Path placeholders
(`{{NAME_SNAKE}}`, `{{NAME_PASCAL}}`) are substituted at copy time.

### `substrate knowledge`

Auto-discover the local-stack reference from `docker-compose.yml` and
`.env.example`. Writes `auto/docs/KNOWLEDGE.md`.

```bash
substrate knowledge refresh
substrate knowledge show
substrate knowledge show --section services
substrate knowledge show --section "environment variables"
```

Values matching the configured redact patterns (default: any key
containing `PASSWORD`, `TOKEN`, `SECRET`, `KEY` — case-insensitive)
are masked as `***REDACTED***` in the generated doc. Configure in
`substrate.config.json`:

```jsonc
{
  "knowledge": {
    "sources": ["docker-compose.yml", ".env.example"],
    "redactPatterns": ["PASSWORD", "TOKEN", "SECRET", "KEY"]
  }
}
```

### `substrate doctor`

Diagnose the substrate installation in the current repo. Reports on:

- Node runtime
- `substrate.config.json` presence + validity
- `auto/` directory structure
- Manifest entries (flags dangling entries that point at missing files)
- Stack alignment (declared vs detected)
- Claude bridge file (when enabled in config)
- Cursor bridge file (when enabled in config)
- MCP bridge file (when enabled in config — v0.8)

Exits 0 clean, non-zero with triage on error. Pass `--json` for
machine-readable output.

```bash
substrate doctor
substrate doctor --json | jq '.summary'
```

### `substrate upgrade`

Diff every scaffolded file against the bundled template at the
*current* substrate version, then either auto-update unmodified files or
walk the user through a three-way merge for each edited file.

```bash
substrate upgrade --check        # report drift; no writes
substrate upgrade --dry-run      # alias for --check
substrate upgrade --apply        # interactive; per-file resolution
```

State machine per tracked file (from `auto/.substrate-manifest.json`):

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
- **merge** — write `<file>.substrate-merge` beside the user's copy with the new template content; user resolves manually.
- **eject** — flip `ejected: true` in the manifest; future upgrades skip this file.

**v0.8: real three-way merge.** When `templates-history/<recordedVersion>/` ships the
content as it shipped originally, the merge UX shows all three anchors:
"your edits since substrate@X" (original → current), "substrate template changes"
(original → new), and "raw drift to resolve" (current → new). When a recorded
version isn't carried in `templates-history/` (e.g. running v0.8 against a manifest
scaffolded by a non-shipped v0.4), the upgrade gracefully falls back to the v0.5
degenerate two-way (`current vs new`) — the header banner makes the merge mode
explicit. Merge files written with `choice=merge` use a git-style conflict-marker
block (`<<<<<<< ORIGINAL` / `||||||| CURRENT` / `>>>>>>> NEW`) when three-way
is available.

### `substrate workflow`

Multi-step automation runtime. Workflows are YAML manifests in
`auto/config/workflows.yaml`; substrate ships a default `new-service`
workflow that demonstrates all three step types.

```bash
substrate workflow list
substrate workflow describe new-service
substrate workflow start new-service --var SERVICE_NAME=billing
```

Three step types (locked schema for v0.5):

- **command** — shell command (spawned with `shell: true`, stdio inherited).
- **audit** — invokes `substrate audit --type <name>` in-process.
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
        command: "substrate create --template service-fastapi --name ${SERVICE_NAME}"
      - name: Audit
        type: audit
        audit: backend
        condition: "${SERVICE_NAME}"
```

### `substrate task` (adapter-driven)

Substrate ships a neutral task-verb surface backed by a pluggable adapter
contract. Set `extensions.taskAdapter` in `substrate.config.json` to an
npm package implementing `TaskAdapter` (see `src/extensions/task-adapter.ts`);
the verbs route through it. When no adapter is configured, the verbs
exit non-zero with an install hint.

```bash
substrate task find OP-660
substrate task search "auth refresh" --limit 10
substrate task create --title "Fix x" --description "..." --priority high --hours 3
substrate task update OP-660 --status in_progress
substrate task complete OP-660 --actual-hours 2.5
```

**Four adapters ship in v0.8** (all under `packages/`):

| Adapter                       | What it talks to                          | Env vars                                       |
| ----------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `@op4z/substrate-adapter-stub`       | Nothing — logs verbs + returns synthetics | (none)                                         |
| `@op4z/substrate-adapter-linear`     | Linear via @linear/sdk                    | `LINEAR_API_KEY`                               |
| `@op4z/substrate-adapter-jira`       | Jira (Cloud or Server) via jira-client    | `JIRA_HOST`, `JIRA_USERNAME`, `JIRA_API_TOKEN` |
| `@op4z/substrate-adapter-github`     | GitHub Issues via Octokit                 | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`  |

Each adapter has its own `README.md` under `packages/adapter-<name>/`.
They all follow the same pattern: structural-typing of the adapter
contract (no build-time import from substrate), inject a client-like
narrow interface for testing, dynamic `import()` at runtime.

To wire a real adapter: install the package, set the env vars,
point `extensions.taskAdapter` at the package name. Substrate loads
it lazily via dynamic `import()` at runtime.

### `substrate mcp serve` (v0.8)

Run substrate as an MCP (Model Context Protocol) server. The third
bridge target alongside Claude Code and Cursor. Exposes read-only
substrate tools to any MCP-aware agent (Claude Desktop, Continue,
Cline, Claude Code's MCP client).

```bash
# Run standalone (stdio transport):
substrate mcp serve

# Scaffold the host registration:
substrate init --bridge mcp
# → .substrate/mcp/substrate-server.json + .substrate/mcp/README.md
```

Tools exposed by v0.8:

- `substrate_audit_list` / `substrate_audit_run`
- `substrate_knowledge_show`
- `substrate_doctor`
- `substrate_workflow_list` / `substrate_workflow_describe`
- `substrate_upgrade_check` (dry-run only)

Write operations (`init`, `add`, `apply`, `task create/update`,
`workflow start`) are NOT exposed in v0.8. Those have side effects
the user should approve via the CLI; v1.0 may add them behind an
explicit `confirm: true` parameter convention.

### VCS adapter (default: built-in git)

The same plugin pattern applies to VCS. `extensions.vcsAdapter` either
points at a package implementing `VcsAdapter` or stays null — in which
case substrate uses the built-in git adapter (`src/adapters/git.ts`),
which shells out to the `git` binary. Future SCM adapters (Mercurial,
Pijul) drop into the same slot.

---

## Configuration

`substrate init` writes `substrate.config.json` at your repo root. v0.8's
shape (`bridges.mcp` added):

```jsonc
{
  "$schema": "https://substrate.dev/schema.json",
  "version": "0.8.0",
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
    "cursor": { "enabled": false, "commandsDir": ".cursor/commands" },
    "mcp":    { "enabled": false, "commandsDir": ".substrate/mcp" }
  },
  "knowledge": {
    "sources": ["docker-compose.yml", ".env.example"],
    "redactPatterns": ["PASSWORD", "TOKEN", "SECRET", "KEY"]
  },
  "extensions": {
    "taskAdapter": null,   // null → `substrate task` exits with install hint
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
node_modules/@op4z/substrate/      (framework — versioned, upgrades freely)
├── bin/substrate            CLI entry point (commander)
├── dist/                  compiled source
│   ├── adapters/git.js    built-in VCS adapter (shell-out to git)
│   ├── extensions/        plugin contracts (TaskAdapter, VcsAdapter, loader)
│   └── ...
└── templates/             source-of-truth defaults (copied on init / add)
    ├── init/              scaffolded by `substrate init`
    ├── audits/            consumed by `substrate add audit <name>`
    ├── standards/         consumed by `substrate add standard <scope>/<area>`
    ├── bridges/
    │   ├── claude/        Claude Code slash-command file
    │   └── cursor/        Cursor slash-command file (v0.5)
    ├── workflows/         bundled workflow definitions (e.g. new-service)
    ├── package-ts/        consumed by `substrate create --template package-ts`
    └── package-python/    consumed by `substrate create --template package-python`

packages/adapter-stub/     (in-repo reference TaskAdapter — copy-paste starting point)

<your repo>/               (scaffolded — owned by you, lives in git)
├── auto/
│   ├── instructions/main/ audit playbooks (editable)
│   ├── standards/         standards docs (editable)
│   ├── config/            scaffolds.yaml + workflows.yaml registries
│   ├── docs/              KNOWLEDGE.md + ADRs
│   └── .substrate-manifest.json
├── substrate.config.json    root config (incl. extensions.taskAdapter / vcsAdapter)
├── .claude/commands/      slash-command bridge (opt-in)
└── .cursor/commands/      slash-command bridge (opt-in)
```

The framework knows where to look; you own what's there. Same model
as shadcn/ui: install once, own forever.

---

## Roadmap

Substrate is being built in phases. v0.8 lands the ecosystem layer:
real three-way merge anchors, MCP bridge, GitHub Action, three
reference adapter packages (Linear, Jira, GitHub Issues), an Astro
docs site, and opt-in telemetry. v1.0 is the GA release.

| Version | Theme                                | Headline additions                                                                                                   |
| ------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| v0.1    | Skeleton                             | `init`, `audit --list/--type`, `create`. Three audit templates. Two scaffold templates.                              |
| v0.3    | Content layer                        | `add`, `knowledge`, `doctor`. 15-audit catalog. 21 standards docs. Stack auto-detection.                             |
| v0.5    | Upgrade + extensibility              | `upgrade` (three-way merge). `task` + `workflow` runtimes. Task/VCS plugin contracts. Cursor bridge. YAML lib swap.  |
| v0.8    | **Hardening + ecosystem (current)** | `templates-history/` real three-way anchors. Monorepo migration. MCP bridge. GitHub Action. 3 reference adapters. Astro docs site. Opt-in telemetry. |
| v1.0    | GA                                   | Semver freeze on `substrate.config`. Public RULES registry contribution mechanism. Migration guide from 0.x. 5 published case studies. npm publish. |

### What's deliberately deferred beyond v0.8

- **Detector runtime** — `audit --type` still emits a stub. The actual
  ripgrep / vulture / pip-audit wrappers + RULES.yaml execution engine
  remain a v1.0+ concern.
- **`substrate review`** — wraps `audit --type pre-merge` with the
  variants (pre, standards, security, deep, doc-gap). v1.0.
- **`substrate standards init/list/for-files`** — once the standards
  bodies are filled in by real projects. v1.0.
- **`substrate config --enable / --disable / --eject`** — v0.8 ships
  only `--telemetry on|off`. Full enable/disable/eject UX is v1.0
  (today users edit `substrate.config.json` directly; `upgrade --apply`
  exercises the eject path).
- **MCP write-side tool exposure** — v0.8 MCP exposes read-only +
  dry-run tools. `init` / `add` / `apply` / `task create|update` /
  `workflow start` are intentionally not exposed; they mutate the
  user's repo and v1.0 will revisit with a `confirm: true` parameter
  convention.
- **Real telemetry endpoint** — v0.8 ships opt-in + local-log
  emission only. v1.0 will add an optional collector with explicit
  secondary consent.
- **npm publish** — still local-only at v0.8. Each adapter declares
  `"private": true` to prevent accidental publish. v1.0 publishes
  `substrate` + `@op4z/substrate-adapter-{stub,linear,jira,github}`.
- **5 case studies** — flagship v1.0 deliverable. Target: 5 external
  repos using substrate in production.
- **Public RULES contribution registry** — PR-based, curated. v1.0.

### v1.0 work cuts that may slip

- **Trademark / CLA** on "Substrate" — open question. CC-BY 4.0 + MIT
  cover usage but not naming.
- **License finalization beyond what `package.json` declares.**
- **Sandboxed RULES detector scripts** (Deno?). Currently scripts
  ship as trust-the-user; v1.0 may add an opt-in sandbox.

---

## GitHub Action (v0.8)

Run substrate audits in CI without per-workflow boilerplate.

```yaml
# .github/workflows/substrate-audit.yml
- uses: BeauGoldberg/@op4z/substrate@v0.8.0
  with:
    command: "audit --type backend"
    working-directory: ./
    fail-on: error
```

Inputs: `command` (required), `working-directory`, `version`
(npm tag, default `latest`), `fail-on` (`none` / `warning` / `error`).
Outputs: `exit-code`, `stdout`, `stderr`, `report-path`
(always written, even on failure).

The action is at `action.yml` + `dist/action/index.js` — both checked
into this repo so `uses:` consumers fetch a working entrypoint directly.

## Docs site (v0.8)

The public docs site (Astro, deployed-target Cloudflare Pages) lives at
`docs-site/`. The site is itself substrate-init'd — any standards/audits
edits you make to substrate flow naturally through the docs site too.

```bash
npm run docs:dev       # local preview (http://localhost:4321/)
npm run docs:build     # produces docs-site/dist/
```

## Telemetry (v0.8, opt-in only)

Substrate collects no usage data unless you opt in. To enable anonymous
events (command name, audit type, error type, substrate version, OS family):

```bash
substrate config --telemetry on    # records preference; events emit going forward
substrate config --telemetry off   # disables
substrate config                   # prints current preference + file paths
```

Events emit to `~/.config/substrate/telemetry.log` only at v0.8 (no
endpoint wired). v1.0 will add an optional collector with explicit
secondary consent. **No project paths, no user identifiers, no rule
body content, no audit findings, no message bodies** are ever recorded.

## Project conventions

- TypeScript with ESM, Node 20+, strict mode on.
- CLI via `commander`. No Handlebars — placeholder substitution is
  plain `String.split().join()`.
- Vitest 4 for unit tests; ESLint + Prettier for static checks.
- All commands have a programmatic entry point (`runInit`,
  `runAuditList`, `runAdd`, `runKnowledgeRefresh`, `runDoctor`, etc.)
  so they can be invoked from JS without spawning a subprocess. The
  CLI is a thin dispatch layer.
- Monorepo via npm workspaces. CLI source lives under
  `packages/substrate/`; root scripts forward to the workspace
  via `--workspaces --if-present`.

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

Substrate ships two test layers, both run by the default `npm test`:

| Layer | Location | What it covers | How it runs |
| ----- | -------- | -------------- | ----------- |
| **Unit** | `tests/*.test.ts` | Programmatic API surface — calls `runInit`, `runAdd`, etc. directly. Fast (~0.3s for the whole layer). | `npm run test:unit` |
| **Integration** | `tests/integration/*.test.ts` | Spawns the built CLI (`dist/cli.js`) as a Node subprocess against a fresh tmp dir per test. Catches bugs the unit layer structurally can't — the v0.3 symlink bug (`3995a60`) is the canonical example: 84 unit tests passed cleanly while `substrate --help` silently no-op'd on the global-bin install path. | `npm run test:integration` |

The integration suite rebuilds `dist/` automatically before any spec runs (via vitest's `globalSetup`), so it's always testing the current source. Each spec maps directly to a smoke-test step in `.agent/SMOKE-2026-05-14.md` — adding a new CLI surface in future milestones means adding both a unit test for the programmatic API and an integration spec for the spawned-binary contract.

End-to-end manual smoke test (still useful when wiring up new commands):

```bash
mkdir -p /tmp/substrate-smoke && cd /tmp/substrate-smoke

# Mark this as a TypeScript repo so auto-detection has something to find
echo '{}' > package.json

CAD=/path/to/substrate/dist/cli.js
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
