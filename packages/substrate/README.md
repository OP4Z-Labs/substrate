# Substrate

> **Self-reinforcing automation runtime for codebases.** Workflows, audits, standards, and org-shared content — composed at install time, validated by AI editor bridges, and improved by a proposal pipeline that catches what you didn't know to enforce.

**Status:** `v3.0.0-beta.2` — pre-release. Stable v2 surface intact; v3 adds the `extends` primitive for org-scoped content distribution.

```bash
npm install @op4z/substrate@beta
```

## What this is

There are three layers in the AI-augmented development stack:

| Layer | Standard | Solved |
|---|---|---|
| Tool protocol — what agents can call | [Model Context Protocol](https://modelcontextprotocol.io/) (Linux Foundation Agentic AI Foundation) | ✓ Universal |
| Single-repo instructions — what humans tell agents | `AGENTS.md` (AAIF) | ✓ Universal |
| **Org-scoped distribution — what an organization tells every agent in every repo** | — | **Substrate** |

Substrate is the third layer. It lets an organization define one canonical set of rules, standards, workflows, hooks, and doc-checks — published as an npm package, a git ref, or a local path — and have every consumer repo `extends` from it. Per-repo overrides where needed. Drift detection where it matters.

It works alongside MCP and AGENTS.md, not in competition with them. Substrate's MCP server bridge exposes its primitives to every MCP-capable AI editor: Claude Code, Cursor, GitHub Copilot CLI, Windsurf, JetBrains AI, Cody, Continue, Cline, Zed, Tabnine, Amazon Q Developer, Replit Agent.

## Quick start

```bash
# Install
npm install @op4z/substrate@beta

# Scaffold the substrate layout in your repo
npx substrate init --bridges claude,cursor,mcp

# Walk the install
npx substrate doctor

# See what's available
npx substrate query rules
npx substrate hooks list
npx substrate query doc-checks --for-files <changed files>

# Run a workflow
npx substrate run audit-pre-merge
```

After `substrate init`:

```
your-repo/
├── substrate/
│   ├── workflows/        # workflow manifests + bodies
│   ├── hooks/            # cross-cutting hooks
│   ├── doc-checks/       # data-driven doc-check rules
│   ├── RULES.yaml        # audit detector registry
│   ├── standards/        # standards docs by scope
│   ├── audits/           # report output
│   ├── sessions/         # workflow execution telemetry
│   └── proposals/        # drift-detection queue
└── substrate.config.json
```

## The headline capabilities

### 1. Self-reinforcing proposal pipeline

Every `substrate run` invocation emits a session-event-log. Six drift detectors compare actual session events against the workflow's manifest + loaded context. Drifts get classified into eight typed proposals (add-to-workflow-step, add-to-memory, add-to-rule, etc.). Proposals queue to `substrate/proposals/pending/`. Walk the queue with `substrate review --proposals` to accept, reject, edit, defer, or skip each.

This is the loop that makes Substrate distinguishable from every other audit framework: **it detects violations of rules you didn't know you needed and proposes the rules.**

### 2. Org-shared content via `extends` (new in v3)

Your organization's canonical rules, workflows, standards live in one place. Consumer repos reference them and inherit their structure.

```json
// substrate.config.json
{
  "name": "my-app",
  "extends": [
    "npm:@yourco/substrate-shared",
    "github:yourco/substrate-shared#main"
  ]
}
```

Three source kinds:

| Form | Use |
|---|---|
| `npm:<pkg>` | published npm package; install once, version-pinned via `package.json` |
| `github:<org>/<repo>[#ref]` | direct git ref; cached at `substrate/.cache/extends/` |
| `file:<path>` | local development; symlink or relative path |

Per-repo overrides take precedence at every kind (workflow, hook, doc-check, rule, standards doc). Collision policy: repo-local wins, warning emitted to stderr. Air-gap mode (`SUBSTRATE_OFFLINE=1`) blocks network fetches; cached content still resolves.

Inspect what's resolved:

```bash
substrate extends list                 # provenance per file
substrate extends list --json          # CI-shaped envelope
substrate extends sync                 # refresh git/file sources
substrate extends clear-cache --json   # wipe local cache
```

Opt out of an upstream source per-repo:

```json
{
  "extends": ["@yourco/substrate-shared"],
  "extends.opt-out": ["workflow:tackle-task"]
}
```

## Core capabilities

| Capability | Status |
|---|---|
| `substrate audit` — RULES.yaml detectors (ripgrep, script, composite) with diff-mode + JSON envelope | ✓ v1 |
| `substrate run <workflow>` — AI-orchestrated workflow runtime with 8 step types | ✓ v2 |
| `substrate validate <manifest>` — JSON Schema validation of workflows, hooks, doc-checks | ✓ v2 |
| `substrate hooks list/describe` — cross-cutting hooks with 6 trigger kinds | ✓ v2 |
| `substrate query rules/standards/memory/doc-checks/sessions` — discovery surface | ✓ v2 |
| `substrate explain <workflow>` — render prompt + context without running | ✓ v2 |
| `substrate doctor` — full-stack diagnostics with `--check <name>` filters | ✓ v2 |
| `substrate scheduler --check/--auto-run` — cron + interval + every-n-commits triggers | ✓ v2 |
| `substrate review --proposals` — walk drift-detected proposal queue | ✓ v2 |
| `substrate watch <path>` — file-change trigger for hooks | ✓ v2 |
| `substrate knowledge refresh/show` — auto-discovery from compose / k8s / env-registry | ✓ v2 |
| `substrate telemetry show/purge/export` — local-log telemetry with bypass-friendly contract | ✓ v2 |
| `substrate uninstall` — manifest-aware clean removal | ✓ v2 |
| **`substrate extends list/sync/clear-cache`** — org-shared content composition (NEW) | **✓ v3 beta** |
| `substrate watch --record` + sequence-pattern detection | planned v3 GA |
| Reverse proposal pipeline (workflow synthesis from passive capture) | planned v3 GA |

## AI editor bridges

`substrate init --bridges <list>` scaffolds bridges into your repo so any tool the bridge supports can invoke substrate as a tool:

| Bridge | Mechanism | Hosts supported |
|---|---|---|
| `claude` | Slash-command at `.claude/commands/substrate.md` | Claude Code |
| `cursor` | Slash-command at `.cursor/commands/substrate.md` | Cursor |
| `mcp` | Host-agnostic MCP server at `substrate mcp serve` | Claude Desktop, Cursor (MCP mode), Copilot CLI, Windsurf, JetBrains AI, Cody, Continue, Cline, Zed, Tabnine, Q Developer, Replit Agent |

The MCP server exposes 7 read-only tools. Configure your host's MCP server registry to point at `substrate mcp serve` and the substrate primitives become available as agent tools without per-tool integration work.

## Workflow manifests

Substrate workflows are declarative YAML with a JSON Schema. A minimal example:

```yaml
# substrate/workflows/audit-pre-merge.yaml
id: audit-pre-merge
description: Diff-only audit gate before merging
trigger:
  - manual-command
  - pre-commit
when:
  files-changed-any: ["src/**/*.{ts,py,go}"]
context:
  standards: ["security.md", "testing.md"]
  rules: ["BE-SEC-*", "FE-PERF-*"]
  memory:
    types: [feedback, project]
    scope: backend
steps:
  - id: scan
    type: invoke-deterministic
    run: substrate audit --diff --json
  - id: review
    type: prompt
    prompt: "Review the audit findings and identify any blockers."
  - id: gate
    type: gate
    must-confirm: true
followups:
  - if: "gate == fail"
    suggest: "Run substrate audit --rule <id> on the failing rule to debug."
acceptance:
  exit_codes: { pass: 0, conditional: 1, fail: 2 }
```

Step types: `invoke-deterministic`, `run-tool`, `prompt`, `prompt-and-action`, `invoke-sub-workflow`, `gate`, `discover`, `propose-doc-change`.

## Status + roadmap

`v3.0.0-beta` is the **pre-release** of the v3 cluster. It ships the extends primitive (NE-11) fully wired through every daily-driver command. Smoke-test verified end-to-end via `npm run smoke:enterprise` (16 scenarios across 4 layers).

| Track | State |
|---|---|
| v2 stable surface (11 primitives) | ✓ shipped, 778 tests passing baseline |
| v3 extends primitive | ✓ shipped in beta.1, 17 new tests, 16/16 smoke |
| v3 reverse proposal pipeline (NE-1 headline) | planned for `v3.0.0` GA |
| v3 supporting primitives (NE-2, NE-5, NE-7, NE-9, EE-1, EE-2) | planned for `v3.0.0` GA |
| `v3.0.0` GA | targeted ~6-10 weeks post-beta.1 |

Install pre-release: `npm install @op4z/substrate@beta`
Install stable (when GA): `npm install @op4z/substrate`

The `@latest` tag stays on v2 until v3 GA. New `--tag beta` releases ship as features land.

## Documentation

- **GitHub:** [op4z-labs/substrate](https://github.com/op4z-labs/substrate)
- **Issues:** [op4z-labs/substrate/issues](https://github.com/op4z-labs/substrate/issues)
- **CHANGELOG:** [CHANGELOG.md](./CHANGELOG.md) in this package
- **Enterprise smoke test:** [`docs/SMOKE-TEST-ENTERPRISE.md`](https://github.com/op4z-labs/substrate/blob/main/docs/SMOKE-TEST-ENTERPRISE.md) — replicable validation procedures + automation
- **Standards bundle:** 25+ pragmatic-default docs ship in `templates/standards/` — scaffolded into your repo where you can edit them

## Contributing

This is MIT-licensed and contributions are welcome. The fastest path to contribute:

1. Open an issue describing the problem or capability
2. Reference the relevant primitive (workflow / hook / doc-check / rule / extends / proposal pipeline)
3. PRs against `main` — substrate's own `npm run smoke:enterprise` runs on every PR via GitHub Actions

For substantial design proposals, open a discussion before opening the PR.

## License

MIT © [OP4Z LLC](https://op4z.dev)

Built by [Beau Goldberg](https://github.com/beaugoldberg).
