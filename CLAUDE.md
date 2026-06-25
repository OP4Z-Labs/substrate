# Substrate — Claude Code Context

> **Last Updated:** 2026-06-25
> **Branch:** main (current working branch: `fix/audit-diff-failsafe-gitignore`)
> **Phase:** v3.0.0-beta — extends primitive shipped, v3 GA targeted ~6-10 weeks out

---

## What this is

`@op4z/substrate` — a self-reinforcing automation runtime for codebases. It ships as one npm package (`@op4z/substrate`) with four surfaces: a CLI, a GitHub Action, an MCP server, and a programmatic JS API. Consumer repos scaffold a `substrate/` directory of YAML manifests (workflows, hooks, doc-checks, RULES.yaml, standards) and drive them through `substrate run <workflow>` and `substrate audit`.

Two things make it distinguishable from a generic audit framework:

1. **Two-layer architecture.** A deterministic core (no AI, no network, no prompt — safe to call from CI / hooks / scripts, every command takes `--json`) sits beneath an AI-aware orchestration layer (walks workflow bodies, dispatches prompts, records session telemetry, fires lifecycle hooks). The orchestration layer never re-implements primitive logic — it calls into the deterministic layer via `invoke-deterministic` steps.

2. **The proposal pipeline.** Every `substrate run` invocation emits a session-event-log. Six drift detectors compare actual session events against the workflow's manifest + loaded context. Drifts get classified into 8 typed proposals that queue to `substrate/proposals/pending/`. A human walks the queue with `substrate review --proposals` and accepts / rejects / edits / defers each. **No AI-drafted edits land in version control without explicit human acceptance.**

**Publish status:** published to npm as `@op4z/substrate` on the `beta` dist-tag. Available versions: `3.0.0-beta.1` through `3.0.0-beta.4`. `@latest` stays on a future v3 GA — there is no v2 published release; the v2 surface ships inside the v3 beta line. The v2 stable surface (11 primitives) is intact; v3 adds the `extends` primitive on top.

**Consumer:** the OP4Z monorepo at `~/dev/TheNexusProject` declares `"@op4z/substrate": "3.0.0-beta.4"` in its root `package.json` and runs `substrate run <workflow-id>` against ~96 vendored workflow files at `~/dev/TheNexusProject/substrate/`. The substrate package supplies the runtime; the consumer repo owns its workflow / hook / rule content. There is no automated sync — the consumer's `substrate/` directory was scaffolded by `substrate init` and is edited in-repo.

---

## Agent Work Protocol

### Before starting

1. **Read this file end-to-end.**
2. **Skim `docs/architecture.md`** for the two-layer model.
3. **For v2 work:** `docs/architecture.md` is canonical. For v3 / `extends` work, the bottom section of `docs/architecture.md` covers NE-11, plus the `src/v2/extends/` source.
4. **For smoke-test changes:** read `docs/SMOKE-TEST-ENTERPRISE.md` — there is a 16-scenario enterprise smoke battery (`npm run smoke:enterprise`) that runs on every PR.

### During work

- **Respect the layer boundary.** A new shell-invocable primitive lives under `src/v2/deterministic/`; a new AI-orchestrated command lives under `src/v2/orchestrator/`. The module path is the layer assignment — don't put orchestration logic in a deterministic file.
- **The orchestrator never re-implements primitive logic.** If a rule executes one way under `substrate audit` and another way under `substrate run audit-service`, that is the v2 design smell the architecture was built to prevent. Call into `deterministic.*` from the orchestrator.
- **`--json` is mandatory on every deterministic command.** The deterministic layer's contract is "machine-parseable first." If you add a command, add a `--json` mode.
- **YAML edits preserve comments.** YAML mutators use `yaml`'s document API via `src/v2/deterministic/yaml-edit.ts`. Never `JSON.stringify(parsedYaml)` and write it back.

### Before committing

```bash
npm run typecheck         # must exit 0
npm run lint              # must exit 0
npm test                  # must pass (75 test files, 805 tests on main)
npm run build             # must produce dist/
```

For changes touching the `extends` resolver, audit detectors, or workflow dispatch, also run `npm run smoke:enterprise` from `packages/substrate/`. The CI matrix runs on Node 20 / 22 / 24.

---

## Tech Stack

- **Language:** TypeScript 6.0, ESM-only (`"type": "module"`), targeting Node 20+ (`engines.node: ">=20.0.0"`)
- **CLI:** Commander 12 (subcommand dispatch in `src/cli.ts`)
- **Validation:** Zod 4 + Ajv 8 with `ajv-formats` (Ajv runs JSON-Schema validation; Zod handles MCP tool inputs and internal parsing)
- **YAML:** `yaml` 2.9 (uses the document API so comments survive round-trips)
- **MCP:** `@modelcontextprotocol/sdk` 1.29 — stdio transport
- **Prompts:** `@inquirer/prompts` 7 for interactive review (`substrate review --proposals`)
- **Color:** `kleur` 4
- **Tests:** Vitest 4
- **Lint / format:** ESLint 8 (typescript-eslint 7) + Prettier 3

The repo is an npm workspace monorepo. The publishable package lives at `packages/substrate/`. Sibling packages (`adapter-github`, `adapter-jira`, `adapter-linear`, `adapter-stub`) are task-tracker adapter stubs — present but not the primary surface. The docs site lives at `docs-site/` (Astro).

---

## Repository Structure

```
substrate/                              # workspace root (private monorepo)
├── packages/
│   ├── substrate/                      # the publishable @op4z/substrate package
│   │   ├── src/
│   │   │   ├── cli.ts                  # CLI entry point (Commander dispatch, 1277 lines)
│   │   │   ├── index.ts                # programmatic API root + deterministic/orchestrator namespaces
│   │   │   ├── audit/                  # v1.0 audit runtime (RULES.yaml detector engine)
│   │   │   ├── commands/               # v1.0 + flat command modules (init, doctor, mcp, knowledge, ...)
│   │   │   ├── bridges/                # AI editor bridge scaffolds (claude / cursor / mcp)
│   │   │   ├── manifest/               # substrate.config.json schema
│   │   │   ├── scaffold/               # template-rendering for substrate init
│   │   │   └── v2/
│   │   │       ├── types.ts            # workflow manifest types (mirror of schemas/workflow.schema.json)
│   │   │       ├── discoverer.ts       # workflow / hook / doc-check discovery
│   │   │       ├── context-loader.ts   # ResolvedContext assembly (standards/rules/memory/knowledge)
│   │   │       ├── validate.ts         # JSON-Schema validation library
│   │   │       ├── hooks.ts            # cross-cutting hook manifests
│   │   │       ├── doc-checks.ts       # conditional doc-check registry
│   │   │       ├── memory.ts           # first-class memory storage
│   │   │       ├── composition.ts      # composes_findings_of resolver
│   │   │       ├── extends/            # v3 extends resolver, source-kinds, merge wrappers
│   │   │       ├── deterministic/      # deterministic v2 CLI surface
│   │   │       │   ├── proposals/      # proposal pipeline (classifier, queue, applicators, review)
│   │   │       │   ├── validate-command.ts
│   │   │       │   ├── query-command.ts
│   │   │       │   ├── hooks-command.ts
│   │   │       │   ├── explain-command.ts
│   │   │       │   ├── watch-command.ts
│   │   │       │   ├── scheduler-command.ts
│   │   │       │   ├── extends-command.ts
│   │   │       │   └── yaml-edit.ts    # comment-preserving YAML mutators
│   │   │       └── orchestrator/       # AI-aware v2 CLI surface
│   │   │           ├── run-command.ts
│   │   │           ├── step-handlers.ts
│   │   │           ├── session-log.ts
│   │   │           ├── drift-detectors.ts
│   │   │           ├── hook-dispatch.ts
│   │   │           └── transport.ts    # OrchestrationTransport contract (Claude Code, Cursor, MCP, stdin)
│   │   ├── schemas/                    # JSON Schemas (workflow.schema.json, hook, doc-check, config)
│   │   ├── templates/                  # init-time scaffolds: workflows, hooks, standards, rules-registry, bridges
│   │   ├── templates-history/          # versioned snapshots of init templates (0.5.0, 1.0.0, 2.0.0)
│   │   └── tests/                      # 75 test files, 805 tests + integration/ + smoke/
│   ├── adapter-github/                 # task-tracker adapter stub
│   ├── adapter-jira/                   # task-tracker adapter stub
│   ├── adapter-linear/                 # task-tracker adapter stub
│   └── adapter-stub/                   # in-memory test adapter
├── action.yml                          # GitHub Action manifest (wraps the CLI for CI)
├── docs/                               # architecture, runtime, schema, migration, smoke procedures
├── docs-site/                          # Astro docs site
├── .agent/                             # session HANDOFF notes (gitignored work logs)
└── scripts/                            # release helpers (copy-changelog.mjs)
```

---

## The Eleven Primitives

The architecture is organized around 11 primitives. The boundary mapping below is from `docs/architecture.md`:

1. **Workflow manifest** (deterministic) — declarative YAML at `substrate/workflows/<id>.yaml` + sibling `.body.md`. Schema: `packages/substrate/schemas/workflow.schema.json`.
2. **Two-layer architecture** (the model itself) — deterministic core + AI-aware orchestration; boundary enforced by module path.
3. **Cross-cutting hooks** (both layers) — fire on `session-start`, `workflow-start`, `workflow-step-completion`, `workflow-completion`, `session-end`, and `file-change`.
4. **Conditional doc-check registry** (deterministic) — data-driven "this file changed → that doc must update" rules. Queried via `substrate query doc-checks --for-files`.
5. **First-class memory** (deterministic) — typed memory files (`feedback`, `project`, `reference`, `user`) injected into `ResolvedContext.memoryInjection`. Bridges to Claude Code's memory directory.
6. **`composes_findings_of`** (deterministic) — a workflow can declare it composes findings from other sidecars; freshness check runs at workflow-start and warns on stale dependencies.
7. **`escalate_after`** (deterministic) — RULES.yaml can escalate severity after N findings or N runs.
8. **`trigger: schedule`** (deterministic) — cron / interval / every-n-commits triggers; `substrate scheduler --check` / `--auto-run`.
9. **Proposal pipeline** (both layers) — drift detection → typed proposals → human-in-loop review. See next section.
10. **`substrate doctor` v2** (deterministic) — full-stack diagnostics with `--check <name>` filters.
11. **Plural knowledge sources** (deterministic) — `substrate/knowledge/*.md` discovered alongside docker-compose. See `docs/knowledge-sources.md`.

v3 adds one additional primitive (NE-11): **`extends`** — org-scoped content composition. A consumer's `substrate.config.json` declares an `extends` array; entries contribute content from `npm:`, `github:`, or `file:` sources. Resolution mirrors ESLint's `extends` order; repo-local always wins. See bottom of `docs/architecture.md`.

---

## The Proposal Pipeline

The differentiator. The flow:

1. **`substrate run` records session events** to `substrate/sessions/<workflow-id>/<timestamp>.jsonl` (`src/v2/orchestrator/session-log.ts`).
2. **Six drift detectors** (`src/v2/orchestrator/drift-detectors.ts`) compare session events against manifest + context:
   - `adhoc-step` — user / AI inserted a step not in the manifest
   - `skipped-step` — a manifest step was skipped
   - `out-of-order` — steps executed in non-manifest order
   - `context-gap` — the workflow needed standards / rules / memory that weren't loaded
   - `repeated-prompt` — the same prompt fired across multiple runs (likely needs codification)
   - `rule-violation-recurrence` — the same RULES.yaml violation keeps reappearing
3. **The classifier** (`src/v2/deterministic/proposals/classifier.ts`) maps drift findings onto typed proposals one-to-many.
4. **Eight typed proposals** (`src/v2/deterministic/proposals/types.ts`) queue to `substrate/proposals/pending/`:
   - `add-to-workflow-step` — codify a recurring ad-hoc step
   - `add-to-memory` — promote a learnable lesson to a memory file
   - `add-to-rule` — codify a recurring violation as a RULES.yaml entry (writes with `manual-review: true` by default)
   - `add-to-standards-doc` — append to a standards doc
   - `add-to-adr` — record an architectural decision
   - `add-to-doc-check-registry` — add a conditional doc-check
   - `strengthen-context-load` — extend a workflow's `context:` declaration
   - `cross-link-existing` — link two existing artifacts
5. **`substrate review --proposals`** (`src/v2/deterministic/proposals/review-command.ts`) walks the queue with `@inquirer/prompts`. Each proposal can be accepted, rejected, edited, deferred, or skipped.
6. **Applicators** (`src/v2/deterministic/proposals/applicators.ts`) apply accepted proposals via the comment-preserving YAML helpers. **The applicator side is deterministic — no AI runs during apply.**

The classifier is deliberately conservative: most proposals start at `low` or `medium` confidence; `high` is reserved for drifts with strong signal (recurrence ≥ 3, repeated-prompt at threshold).

---

## Surfaces

### CLI (`substrate ...`)

Entry: `src/cli.ts` (Commander dispatch, 1277 lines). The bin name is `substrate`, mapped to `dist/cli.js`. Major top-level commands:

`init`, `add`, `create`, `audit`, `doctor`, `knowledge`, `task`, `workflow`, `upgrade`, `mcp serve`, `uninstall`, `validate`, `query <rules|standards|memory|doc-checks|sessions>`, `hooks <list|describe>`, `run <workflow>`, `review --proposals`, `explain <workflow>`, `watch <path>`, `scheduler <--check|--auto-run>`, `extends <list|sync|clear-cache>`, `telemetry <show|purge|export>`.

### GitHub Action (`action.yml`)

A composite Node 20 action that wraps the CLI for CI. Inputs: `command` (the substrate subcommand + flags), `working-directory`, `version` (defaults to `latest`), `fail-on` (`none` / `error` / `warning`). Outputs: `exit-code`, `stdout`, `stderr`, `report-path`. Action entry: `dist/action/index.js`.

### MCP server (`substrate mcp serve`)

Defined in `src/commands/mcp.ts`. Stdio transport via `@modelcontextprotocol/sdk`. Exposes 7 **read-only** tools (`substrate_audit_list`, `substrate_audit_run`, `substrate_knowledge_show`, `substrate_doctor`, `substrate_workflow_list`, `substrate_workflow_describe`, `substrate_upgrade_check`). Writes that mutate the consumer repo are intentionally absent — the bridge contract is "read / dry-run only" until the v1.0 surface adds an explicit confirmation parameter convention.

### Programmatic API

```ts
import { deterministic, orchestrator } from "@op4z/substrate";

deterministic.validateManifest(parsedYaml);
deterministic.discoverWorkflows({ cwd: "/repo" });
deterministic.loadContext({ workflow, cwd: "/repo" });
deterministic.runQueryRules({ byPrefix: ["BE-PY-*"], json: true });

await orchestrator.runV2Workflow({ workflowId: "audit-service", cwd: "/repo" });
```

v1.0's flat exports (`runInit`, `runAuditExecute`, …) remain on the package root for backwards compatibility; new code should prefer the namespaced imports.

---

## Common Commands

```bash
# From the workspace root
npm run build               # tsc -b across workspaces
npm test                    # vitest run across workspaces
npm run lint                # eslint across workspaces
npm run typecheck           # tsc --noEmit across workspaces
npm run docs:dev            # local docs site preview
npm run docs:build          # build docs site
npm run smoke:enterprise    # 16-scenario enterprise smoke test

# From packages/substrate/
npm run test:unit           # unit tests only
npm run test:integration    # integration tests only
npm run test:watch          # vitest in watch mode
npm run smoke:enterprise    # bash tests/smoke/enterprise-smoke.sh
npm run prepack             # copy CHANGELOG from package to tarball
```

---

## Architectural Decisions Worth Knowing

- **The deterministic / orchestration split is a hard contract, not a guideline.** Mixing AI calls into a deterministic command, or re-implementing primitive logic in the orchestrator, is the design smell the architecture exists to prevent. Module path is the layer assignment.
- **No third "non-AI workflow interpreter" layer.** Workflows are either deterministic primitives or AI-orchestrated. There is no shadow runtime that re-implements the orchestrator deterministically — that would drift from the AI's actual behavior.
- **No-transport mode is intentional.** When `substrate run` executes with no attached `OrchestrationTransport`, AI-step types emit `prompt-issued` session events, gates auto-approve, and the workflow runs deterministically end-to-end. This is the shape CI and tests rely on.
- **YAML mutations preserve comments.** All YAML writes go through `src/v2/deterministic/yaml-edit.ts`, which uses the `yaml` package's document API. A round-trip never loses comments, blank lines, or key order.
- **No AI-drafted edits land in version control without human review.** The proposal pipeline is the gating mechanism. Drift detectors and the classifier are pure; applicators are deterministic. The AI never writes to RULES.yaml / standards / workflows directly.
- **Backwards compat is preserved through majors.** v1.0 flat exports stay on the package root through v3. A v2 consumer upgrading to v3 sees zero behavior change unless they declare `extends`.
- **Air-gap is a first-class mode.** `SUBSTRATE_OFFLINE=1` blocks `github:` extends fetches; warm caches continue to serve, cold caches emit a warning.

---

## What NOT to do

- **Don't put AI calls in `src/v2/deterministic/` or `src/audit/` or `src/commands/{doctor,knowledge,validate,...}.ts`.** Those modules are imported by the deterministic namespace and must remain shell-safe.
- **Don't re-implement RULES.yaml matching in the orchestrator.** Call `deterministic.*` from `src/v2/orchestrator/run-command.ts` and step handlers.
- **Don't write to YAML without using `yaml-edit.ts`.** Bare `yaml.stringify(JSON.parse(JSON.stringify(doc)))` round-trips lose comments and reorder keys — the proposal applicators rely on the helpers.
- **Don't expand the MCP tool surface to include writes** without an explicit `confirm: true` parameter convention. v0.8 deliberately ships read-only.
- **Don't bypass the proposal pipeline.** Drift findings that bypass the classifier and write directly to RULES.yaml / standards / memory are exactly what the architecture rejects.
- **Don't add a primitive without picking a layer.** A new primitive belongs to either `src/v2/deterministic/` or `src/v2/orchestrator/`. If you think it spans both (like hooks and proposals), split it — the dispatcher is orchestration, the applicator is deterministic.
- **Don't commit `.agent/HANDOFF-*.md` files casually.** They are session work logs. The git history shows they sometimes get committed (`chore(smoke): HANDOFF — V3-SMOKE-2026-05-16`) but the default is gitignored.

---

## Commit Conventions

Format follows the global `<type>(<scope>): <subject>` pattern. Substrate-specific scopes from recent history: `release`, `audit`, `extends`, `smoke`, `rules`, `init`, `memory`, `templates`, `v2`, `changelog`.

Substrate is its own product, not part of OP4Z's task system. Don't add `[OP-###]` tags here — substrate commits don't link to the OP4Z task tracker.

When releasing a beta: bump `packages/substrate/package.json` version, update `packages/substrate/CHANGELOG.md`, commit as `chore(release): substrate <version>`. The `prepack` script copies the package's CHANGELOG into the tarball; verify `npm pack --dry-run` shows `dist/cli.js` and `dist/index.js` before publishing — both `3.0.0-beta.1` and `3.0.0-beta.2` shipped without `dist/` due to a stale `tsconfig.tsbuildinfo` (see beta.3 changelog).

---

_This file is the primary context document for Claude Code in this repo. For deeper detail, see `docs/architecture.md`, `docs/SMOKE-TEST-ENTERPRISE.md`, `docs/programmatic-api.md`, and `docs/release-2.0-checklist.md`._
