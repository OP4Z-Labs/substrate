# Cadence

> Repeatable automation patterns for codebases. Audits, scaffolds, standards, and a Claude Code bridge — scaffolded into your repo where you own them.

**Status:** v0.1 (skeleton). Local development only; not yet published to npm.

Cadence is the public extraction of a `./exc + /run` automation system
that grew up inside a private monorepo. It separates the **framework**
(versioned, lives in `node_modules/cadence`) from the **opinionated
content** (audit playbooks, standards, scaffolds — scaffolded into
your repo where you can edit them). Same model that made shadcn/ui
click: install once, own forever.

---

## What ships in v0.1

| Capability                                                              | Status |
| ----------------------------------------------------------------------- | ------ |
| `cadence init` — scaffold `auto/`, `cadence.config.json`, manifest stub | yes    |
| `cadence init --with-claude` — also scaffold the Claude Code bridge     | yes    |
| Three default audit instruction templates (pre-merge, deps, dead-code)  | yes    |
| Two scaffold templates (`package-ts`, `package-python`)                 | yes    |
| `cadence audit --list` — enumerate scaffolded audits                    | yes    |
| `cadence audit --type <name>` — load instruction + stub report          | yes    |
| `cadence create --template <name> --name <foo>` — scaffold a package   | yes    |
| Unit tests covering scaffolding contracts (23 tests)                    | yes    |

**Explicitly NOT in v0.1.** See the [roadmap](#roadmap) for when each
arrives. Calling a deferred command exits with code 2 and a hint.

---

## Install

v0.1 is local-only — no npm publish yet. To try it inside this repo:

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

## Usage

### `cadence init`

Scaffold the auto/ directory, root config, and (optionally) the
Claude Code bridge.

```bash
cadence init                              # use directory name as project name
cadence init --name my-app --short-code MA
cadence init --with-claude                # also scaffold .claude/commands/cadence.md
cadence init --stack python               # narrow the stacks list
```

After running, your repo gains:

```
auto/
├── commands/                # (empty — for your slash-command surface)
├── instructions/main/       # audit playbooks (yours to edit)
│   ├── audit-pre-merge.md
│   ├── audit-dependencies.md
│   └── audit-dead-code.md
├── scripts/                 # (empty — for your local scripts)
├── config/
│   └── project.yaml
├── standards/               # (empty — for your team's standards)
├── audits/                  # audit report output
├── docs/                    # decisions, knowledge
├── README.md
└── .cadence-manifest.json   # tracked-scaffolds manifest (for v0.5 upgrade)
cadence.config.json
.claude/commands/cadence.md  # only with --with-claude
```

Re-running `cadence init` is safe: existing files are skipped, not
overwritten. The framework reads from your copy at runtime.

### `cadence audit --list`

List the audit instructions scaffolded under
`auto/instructions/main/audit-*.md`.

```bash
$ cadence audit --list

Audits available (3)

  dead-code     Unreachable code, unused exports, orphan files...
  dependencies  Outdated packages, known CVEs, license compliance...
  pre-merge     Diff-only fast gate. Audits files changed in...

  Run: cadence audit --type <name>
```

Pass `--json` to emit machine-readable output for CI / scripts.

### `cadence audit --type <name>`

Load the matching instruction file and emit a structured stub report.

```bash
$ cadence audit --type pre-merge

Audit: pre-merge
  instruction: /path/to/auto/instructions/main/audit-pre-merge.md
  description: Diff-only fast gate...

⚠ v0.1 stub: no detectors executed.
  In v0.1, cadence reads the instruction file and confirms it is
  well-formed. The detector runtime (RULES.yaml + ripgrep / vulture /
  pip-audit / knip wrappers) ships in v0.3.

Findings: 0 (stub)
```

In v0.1 this is a stub — the detector runtime ships in v0.3. The
contract (where instructions live, what front-matter they carry) is
stable now so AI assistants can lean on it.

### `cadence create --template <name> --name <foo>`

Scaffold a new package or service from a bundled template.

```bash
cadence create --template package-ts --name my-utils
cadence create --template package-python --name my_pylib
```

Available templates in v0.1:

| Template         | Destination                       | Notes                          |
| ---------------- | --------------------------------- | ------------------------------ |
| `package-ts`     | `packages/typescript/<name>`      | TypeScript + Vitest skeleton   |
| `package-python` | `packages/python/<name>`          | Poetry + Pytest skeleton       |

Path placeholders (`{{NAME_SNAKE}}` for the Python source directory)
are substituted at copy time. Override the destination with
`--destination <path>` if your repo doesn't use the default layout.

---

## Configuration

`cadence init` writes `cadence.config.json` at your repo root:

```json
{
  "$schema": "https://cadence.dev/schema.json",
  "version": "0.1.0",
  "project": { "name": "my-app", "shortCode": "MA" },
  "stacks": ["python", "typescript"],
  "paths": { /* ... */ },
  "defaults": {
    "audits": ["pre-merge", "dependencies", "dead-code"],
    "scaffolds": ["package-ts", "package-python"]
  },
  "bridges": { "claude": { "enabled": true } },
  "telemetry": { "enabled": false }
}
```

The schema is documented inline in `src/util/types.ts`. Most fields
are read-only placeholders in v0.1 (they configure features that ship
in later versions).

---

## Architecture

Two-layer separation — the core design decision:

```
node_modules/cadence/      (framework — versioned, upgrades freely)
├── bin/cadence            CLI entry point (commander)
├── dist/                  compiled source
└── templates/             source-of-truth defaults (copied on init)

<your repo>/               (scaffolded — owned by you, lives in git)
├── auto/
│   ├── instructions/main/ audit playbooks (editable)
│   ├── config/            project + command registry
│   └── ...
├── cadence.config.json    root config
└── .claude/commands/      slash-command bridges (opt-in)
```

The framework knows where to look; you own what's there. Same model
as shadcn/ui: install once, own forever.

---

## Roadmap

Cadence is being built in phases. v0.1 ships the skeleton; later
versions fill in detectors, content, and ecosystem.

| Version | Theme                       | Headline additions                                                                            |
| ------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| v0.1    | Skeleton                    | `init`, `audit --list/--type`, `create`. Three audit templates. Two scaffold templates.       |
| v0.3    | Content layer               | `add`, `review`, `standards`, `knowledge`, `doctor`. Full 15-audit set. Stack auto-detection. |
| v0.5    | Upgrade + extensibility     | `workflow`, `config`, `upgrade` (three-way merge). Plugin interface for task / VCS adapters.  |
| v0.8    | Hardening + ecosystem       | MCP server bridge. GitHub Action. Telemetry first ship (opt-in). Reference adapter packages.  |
| v1.0    | GA                          | Semver freeze on `cadence.config`. Public RULES registry contribution mechanism.              |

### What's deliberately deferred

- **Detector runtime** — v0.1's `audit --type` prints a stub. The
  actual ripgrep / vulture / pip-audit wrappers ship in v0.3.
- **Stack auto-detection** — v0.1 assumes Python + TypeScript. v0.3
  detects from manifest files.
- **`cadence upgrade`** — the three-way merge flow that diffs your
  edits against new template versions. v0.5.
- **Plugin interface** — for task adapters (Linear / Jira / GitHub
  Issues) and VCS adapters. v0.5.
- **Cursor / MCP bridges** — additional editor bridges. v0.5+.
- **Telemetry** — opt-in, off by default. v0.8 first ships the prompt.

---

## Project conventions

- TypeScript with ESM, Node 20+, strict mode on.
- CLI via `commander`. No Handlebars — placeholder substitution is
  plain `String.split().join()`.
- Vitest for unit tests; ESLint + Prettier for static checks.
- All commands have a programmatic entry point (`runInit`,
  `runAuditList`, etc.) so they can be invoked from JS without
  spawning a subprocess. The CLI is a thin dispatch layer.

---

## Development

```bash
npm install
npm run build       # tsc -b
npm run lint        # eslint
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run format      # prettier --write
```

End-to-end smoke test:

```bash
mkdir -p /tmp/cadence-smoke && cd /tmp/cadence-smoke
node /path/to/cadence/dist/cli.js init --name smoke --with-claude
node /path/to/cadence/dist/cli.js audit --list
node /path/to/cadence/dist/cli.js audit --type pre-merge
node /path/to/cadence/dist/cli.js create --template package-ts --name hello
```

---

## License

MIT — see [LICENSE](./LICENSE).
