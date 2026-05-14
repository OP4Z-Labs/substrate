# Cadence

> Repeatable automation patterns for codebases. Audits, scaffolds, standards, and a Claude Code bridge — scaffolded into your repo where you own them.

**Status:** v0.3 (content layer). Local development only; not yet published to npm.

Cadence is the public extraction of a `./exc + /run` automation system
that grew up inside a private monorepo. It separates the **framework**
(versioned, lives in `node_modules/cadence`) from the **opinionated
content** (audit playbooks, standards, scaffolds — scaffolded into
your repo where you can edit them). Same model that made shadcn/ui
click: install once, own forever.

---

## What ships in v0.3

| Capability                                                                          | Status |
| ----------------------------------------------------------------------------------- | ------ |
| `cadence init` — scaffold `auto/`, `cadence.config.json`, manifest stub             | yes    |
| Stack auto-detection (Python / TypeScript / Go / Rust)                              | yes    |
| `cadence init --with-claude` — also scaffold the Claude Code bridge                 | yes    |
| 15-audit catalog scaffold-able via `cadence add audit <name>`                       | yes    |
| 21 standards docs scaffold-able via `cadence add standard <scope/area>`             | yes    |
| `cadence add scaffold|command|workflow` — incremental item scaffolding              | yes    |
| `auto/.cadence-manifest.json` tracks every scaffold (sha256 + template version)     | yes    |
| `cadence audit --list` / `--type <name>` (instruction-file aware stub)              | yes    |
| `cadence create --template <name> --name <foo>` — scaffold a package                | yes    |
| `cadence knowledge refresh` — auto-discover services + env from docker-compose      | yes    |
| `cadence knowledge show [--section <name>]` — print or section the generated doc    | yes    |
| `cadence doctor` — diagnostic command (config, manifest, stack, bridge)             | yes    |
| Unit tests (84 tests across 10 files; lint + tsc + build all clean)                 | yes    |

**Explicitly NOT in v0.3.** See the [roadmap](#roadmap) for when each
arrives. Calling a still-deferred command (`review`, `standards`,
`config`, `upgrade`) exits with code 2 and a hint.

---

## Install

v0.3 is local-only — no npm publish yet. To try it inside this repo:

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
# 1. Scaffold the auto/ tree, config, and (optionally) the Claude bridge
cadence init --with-claude

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

# 6. Verify the install is healthy
cadence doctor
```

---

## Commands

### `cadence init`

Scaffold the `auto/` directory, root config, and (optionally) the
Claude Code bridge.

```bash
cadence init                              # auto-detect stack from markers
cadence init --name my-app --short-code MA
cadence init --with-claude                # also scaffold .claude/commands/cadence.md
cadence init --stack python               # explicit override
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

In v0.3 `--type <name>` still emits a stub. The detector runtime (rule
execution, score aggregation) ships in v0.5. The contract (where
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

Exits 0 clean, non-zero with triage on error. Pass `--json` for
machine-readable output.

```bash
cadence doctor
cadence doctor --json | jq '.summary'
```

---

## Configuration

`cadence init` writes `cadence.config.json` at your repo root. v0.3's
shape:

```jsonc
{
  "$schema": "https://cadence.dev/schema.json",
  "version": "0.3.0",
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
    "claude": { "enabled": true, "commandsDir": ".claude/commands" },
    "cursor": { "enabled": false }
  },
  "knowledge": {
    "sources": ["docker-compose.yml", ".env.example"],
    "redactPatterns": ["PASSWORD", "TOKEN", "SECRET", "KEY"]
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
└── templates/             source-of-truth defaults (copied on init / add)
    ├── init/              scaffolded by `cadence init`
    ├── audits/            consumed by `cadence add audit <name>`
    ├── standards/         consumed by `cadence add standard <scope>/<area>`
    ├── bridges/           Claude Code (today), Cursor (v0.5+)
    ├── package-ts/        consumed by `cadence create --template package-ts`
    └── package-python/    consumed by `cadence create --template package-python`

<your repo>/               (scaffolded — owned by you, lives in git)
├── auto/
│   ├── instructions/main/ audit playbooks (editable)
│   ├── standards/         standards docs (editable)
│   ├── config/            project + scaffolds + workflows registries
│   ├── docs/              KNOWLEDGE.md + ADRs
│   └── .cadence-manifest.json
├── cadence.config.json    root config
└── .claude/commands/      slash-command bridges (opt-in)
```

The framework knows where to look; you own what's there. Same model
as shadcn/ui: install once, own forever.

---

## Roadmap

Cadence is being built in phases. v0.3 ships the content layer; later
versions add the upgrade flow, the detector runtime, and the ecosystem.

| Version | Theme                       | Headline additions                                                                            |
| ------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| v0.1    | Skeleton                    | `init`, `audit --list/--type`, `create`. Three audit templates. Two scaffold templates.       |
| v0.3    | **Content layer (current)** | `add`, `knowledge`, `doctor`. 15-audit catalog. 21 standards docs. Stack auto-detection.      |
| v0.5    | Upgrade + extensibility     | `workflow`, `config`, `upgrade` (three-way merge). Detector runtime. Plugin interface.        |
| v0.8    | Hardening + ecosystem       | MCP server bridge. GitHub Action. Telemetry first ship (opt-in). Reference adapter packages.  |
| v1.0    | GA                          | Semver freeze on `cadence.config`. Public RULES registry contribution mechanism.              |

### What's deliberately deferred beyond v0.3

- **Detector runtime** — `audit --type` still emits a stub. The actual
  ripgrep / vulture / pip-audit wrappers ship in v0.5.
- **`cadence upgrade`** — the three-way merge flow that diffs your
  edits against new template versions. v0.5.
- **`cadence review`** — wraps `audit --type pre-merge` with the
  variants (pre, standards, security, deep, doc-gap). v0.5.
- **`cadence standards init/list/for-files`** — once the standards
  bodies are filled in by real projects. v0.5.
- **`cadence workflow start`** — workflow runtime executor. v0.5.
- **Plugin interface** — for task adapters (Linear / Jira / GitHub
  Issues) and VCS adapters. v0.5.
- **Cursor / MCP bridges** — additional editor bridges. v0.5+.
- **Telemetry** — opt-in, off by default. v0.8 first ships the prompt.

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
npm test            # vitest run (84 tests)
npm run typecheck   # tsc --noEmit
npm run format      # prettier --write
```

End-to-end smoke test:

```bash
mkdir -p /tmp/cadence-smoke && cd /tmp/cadence-smoke

# Mark this as a TypeScript repo so auto-detection has something to find
echo '{}' > package.json

node /path/to/cadence/dist/cli.js init --name smoke --with-claude
node /path/to/cadence/dist/cli.js add audit security
node /path/to/cadence/dist/cli.js add standard frontend/react
node /path/to/cadence/dist/cli.js doctor
```

---

## License

MIT — see [LICENSE](./LICENSE).
