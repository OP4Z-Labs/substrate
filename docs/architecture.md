# Substrate — architecture

> **Status:** v2.0 draft (Phase B2). The two-layer model + primitives
> 1–7 ship in this release; primitives 8–11 layer in over B3/B4. See
> the project plan for the full eleven-primitive roadmap.

Substrate is built as a **layered runtime** with one bright line in the
middle: **deterministic primitives below, AI-aware orchestration above.**

Everything in the deterministic layer runs from a shell with no AI
session, no network, and no interactive prompt. Everything in the
orchestration layer needs an AI session because its job is to walk a
workflow's prose body, prompt the model step-by-step, and surface
proposals.

This document describes the model, the surface of each layer, and the
rules contributors follow to keep the boundary clean.

---

## Why two layers

OP4Z (the workspace where Substrate was extracted from) ran on two
parallel command surfaces: `./exc` for deterministic shell operations
and `/run` for AI-orchestrated workflows. The split worked because each
side stayed narrow:

- `./exc audit --services` listed services without consulting the AI.
- `/run audit --backend authentication` orchestrated a multi-step audit
  with the AI loading standards, applying rules, and producing a
  scored report.

Substrate v2 formalizes that split. Workflows can call deterministic
primitives via `invoke-deterministic` steps; the orchestrator never
re-implements primitive logic. If a rule executes one way under
`substrate audit` and another way under `substrate run audit-service`,
that's a v2 design smell (plan §12 R3).

A note on what we **don't** ship: a third "non-AI workflow interpreter"
layer. That would be a duplicate runtime that drifts from the AI's
actual behavior — every primitive in v2 is either deterministic and
shell-invocable, or AI-orchestrated. No middle.

---

## Layer 1 — Deterministic primitives

Pure operations. Safe to call from CI scripts, git hooks, or
non-interactive contexts. Output is machine-parseable first; every
command takes `--json`.

### What the deterministic layer never does

- Call an AI model.
- Prompt the user via stdin.
- Depend on a network resource.
- Mutate state outside the consumer repo's working tree (and even then,
  only when the function name says `write` / `emit`).

### Commands and modules

| Command                          | Module                                           | Notes                                                          |
| -------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `substrate audit`                | `src/audit/`                                     | v1.0; runs RULES.yaml detector runtime. v2.0 (B2) applies `escalate_after`. |
| `substrate doctor`               | `src/commands/doctor.ts`                         | v1.0; installation + config sanity checks.                     |
| `substrate validate [path]`      | `src/v2/deterministic/validate-command.ts`       | v2.0; JSON-Schema validation of workflow manifests.            |
| `substrate query rules`          | `src/v2/deterministic/query-command.ts`          | v2.0; filter RULES.yaml by id glob.                            |
| `substrate query standards`      | `src/v2/deterministic/query-command.ts`          | v2.0; list standards docs.                                     |
| `substrate query memory`         | `src/v2/deterministic/query-command.ts`          | v2.0 (B2); first-class memory with Claude Code bridge.         |
| `substrate query doc-checks`     | `src/v2/deterministic/query-command.ts`          | v2.0 (B2); evaluate conditional-doc-check registry.            |
| `substrate hooks list`           | `src/v2/deterministic/hooks-command.ts`          | v2.0 (B2); inspect cross-cutting hooks.                        |
| `substrate hooks describe <id>`  | `src/v2/deterministic/hooks-command.ts`          | v2.0 (B2); show one hook's full manifest.                      |
| `substrate knowledge`            | `src/commands/knowledge.ts`                      | v1.0; regenerate KNOWLEDGE.md from docker-compose.             |
| `substrate explain <id>`         | `src/v2/deterministic/explain-command.ts`        | v2.0; show context + prompts a workflow would emit, without running it. |
| `substrate watch [path]`         | `src/v2/deterministic/watch-command.ts`          | v2.0; long-running watcher; fires `file-change` hooks on save. |
| `substrate scheduler --check`    | `src/v2/deterministic/scheduler-command.ts`      | v2.0; list scheduled workflows.                                |
| `substrate scheduler --auto-run` | `src/v2/deterministic/scheduler-command.ts`      | v2.0; fire every overdue scheduled workflow.                    |
| `substrate emit-sidecar`         | (planned)                                        | Writes audit sidecar JSON.                                     |

The Discoverer (`src/v2/discoverer.ts`) and Context loader
(`src/v2/context-loader.ts`) are deterministic library modules that
sit beneath the commands. They have no CLI surface of their own; they
are how the runtime (and the orchestrator) resolves "what does this
workflow know about its surroundings."

### Programmatic surface

```ts
import { deterministic } from "@op4z/substrate";

// Schema validation
const result = deterministic.validateManifest(parsedYaml);
const fileResult = deterministic.validateManifestFile("substrate/workflows/x.yaml");

// Discovery
const { workflows } = deterministic.discoverWorkflows({ cwd: "/repo" });

// Context resolution (pure: same inputs → same output)
const context = deterministic.loadContext({
  workflow: workflow.manifest,
  cwd: "/repo",
});

// Queries
deterministic.runQueryRules({ byPrefix: ["BE-PY-*"], json: true });
deterministic.runQueryStandards({ patterns: ["backend/*.md"], json: true });
deterministic.runQueryMemory({ types: ["feedback"], scope: "backend" });
deterministic.runQueryDocChecks({ forFiles: ["apps/foo.py"] });

// Hooks (cross-cutting)
deterministic.runHooksList({ trigger: ["workflow-completion"] });
deterministic.runHooksDescribe({ id: "auto-emit-sidecar" });

// Memory (programmatic)
const { memories } = deterministic.queryMemory({
  types: ["feedback"],
  scope: "backend",
});
```

The `deterministic.*` namespace is the recommended import path for v2
consumers. Flat re-exports of v1.0 functions (`runAuditExecute`,
`runDoctor`, etc.) remain on the package root for backwards
compatibility; new code should import through the namespace.

---

## Layer 2 — AI-aware orchestration

Operations that need an AI session because their job is to render
prompts, walk a workflow body step-by-step, and surface judgment-rich
output.

### What the orchestration layer does

- Loads context via the deterministic loader.
- Dispatches `<workflow>.body.md` to the AI session.
- Walks the manifest's `steps:` array, prompting the model for each
  AI-step type.
- Records session-event telemetry (B3).
- Invokes cross-cutting hooks (B2).

### What the orchestration layer never does

- Re-implement rule execution. Rules run through the deterministic
  layer's runner; the orchestrator calls into it but does not
  duplicate the matching/scoring logic.
- Mutate the user's repo without an explicit step instructing it to.
  Side effects come from `invoke-deterministic`, `run-tool`, or
  `propose-doc-change` steps — never from the runtime itself.

### Commands and modules

| Command                            | Module                                  | Notes                                                                                |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| `substrate run <workflow>`         | `src/v2/orchestrator/run-command.ts`    | v2.0 (B1 skeleton); B2/B3 expand the step engine.                                    |
| `substrate review --proposals`     | (B3)                                    | Walks the proposal queue.                                                            |
| `substrate workflow create`        | (later)                                 | Interactive workflow authoring.                                                      |

### B1/B2 step support

`substrate run` step coverage as of B2:

- `invoke-deterministic` and `run-tool` — fully runnable. The step's
  `run` shell command executes under the consumer's CWD. Stdout/stderr
  are inherited.
- AI-step types (`prompt`, `prompt-and-action`, `invoke-sub-workflow`,
  `gate`, `discover`, `propose-doc-change`) — run end-to-end through
  the step engine (`src/v2/orchestrator/step-handlers.ts`). When an
  `OrchestrationTransport` is attached, prompts round-trip through it
  (Claude Code, Cursor, MCP, plain stdin). When no transport is
  attached, the engine runs in "no-transport mode": prompts emit
  `prompt-issued` session events, responses default to `null`, gates
  auto-approve, and the workflow remains fully deterministic — the
  shape CI / tests rely on.

### Lifecycle hooks fire at four points

| Trigger                     | Fires                                                      |
| --------------------------- | ---------------------------------------------------------- |
| `session-start`             | Once at the start of `substrate run` (before workflow-start) |
| `workflow-start`            | Before the first step                                       |
| `workflow-step-completion`  | After each step (regardless of outcome)                     |
| `workflow-completion`       | Once after the last step (regardless of exit code)          |
| `session-end`               | Once after workflow-completion (mirror of session-start)    |
| `file-change`               | Fired from `substrate watch` on filesystem save events      |

Each hook invocation surfaces in `result.hookRuns` and (by default)
does not fail the workflow. Setting `step.fail-on-error: true` on a
hook escalates that.

What surrounds the step engine:

- **`composes_findings_of` freshness check** runs before the first
  step. Stale sidecar dependencies surface as warnings at workflow
  start.
- **Memory injection** is rendered into `ResolvedContext.memoryInjection`
  during context-load and is available to the orchestrator before
  step dispatch.
- **`substrate watch <path>`** is the producer for `file-change`
  hooks. Long-running foreground watcher; Ctrl-C exits cleanly. Uses
  `node:fs.watch` recursively (Node 20+); no external deps.

### Programmatic surface

```ts
import { orchestrator } from "@op4z/substrate";

const summary = await orchestrator.runV2Workflow({
  workflowId: "audit-service",
  cwd: "/repo",
  dryRun: false,
  json: false,
});

// summary.exitCode is 0 (clean), 1 (step failed), or 2 (deferred)
```

---

## The boundary in code

Two structural conventions enforce the layer split:

### 1. Module paths encode layer intent

```
src/
├── audit/                   # deterministic (v1.0)
├── commands/                # deterministic (v1.0 + flat re-exports)
├── v2/
│   ├── deterministic/       # deterministic v2 surface
│   │   ├── validate-command.ts
│   │   ├── query-command.ts
│   │   └── index.ts         # namespace barrel
│   ├── orchestrator/        # AI-aware v2 surface
│   │   ├── run-command.ts
│   │   └── index.ts         # namespace barrel
│   ├── discoverer.ts        # deterministic library
│   ├── context-loader.ts    # deterministic library
│   ├── validate.ts          # deterministic library
│   └── types.ts             # shared
└── index.ts                 # entry point: deterministic + orchestrator namespaces
```

When you add a v2 capability, the path decides the layer. A new shell-
invocable primitive lives under `src/v2/deterministic/`; a new
AI-orchestrated command lives under `src/v2/orchestrator/`.

### 2. Programmatic API exposes the layers as namespaces

The package root exports:

```ts
import substrate, { deterministic, orchestrator } from "@op4z/substrate";
```

Consumers can be explicit:

```ts
// Pure CI script — only the deterministic layer
import { deterministic } from "@op4z/substrate";
const result = deterministic.runValidate({ json: true });

// Workflow-driving harness — wants the orchestrator too
import { deterministic, orchestrator } from "@op4z/substrate";
```

The flat re-exports at the package root (`runInit`, `runAuditExecute`,
…) remain from v1.0 for backwards compatibility. New code should
prefer the namespaced imports.

---

## Future layers

The two-layer model accommodates everything in the eleven-primitive
roadmap. Each future primitive belongs to one layer:

| Primitive                        | Layer            | Phase |
| -------------------------------- | ---------------- | ----- |
| 1. Workflow manifest             | deterministic    | B1    |
| 2. Two-layer architecture        | (the model)      | B1    |
| 3. Cross-cutting hooks           | both             | B2    |
| 4. Conditional-doc-check registry| deterministic    | B2    |
| 5. First-class memory            | deterministic    | B2    |
| 6. `composes_findings_of`        | deterministic    | B2    |
| 7. `escalate_after`              | deterministic    | B2    |
| 8. `trigger: schedule`           | deterministic    | B3    |
| 9. Proposal pipeline             | both             | B3    |
| 10. `substrate doctor` v2        | deterministic    | B4    |
| 11. Plural knowledge sources     | deterministic    | B4    |

Cross-cutting hooks (#3) and the proposal pipeline (#9) span both
layers because the **dispatching mechanism** is orchestration (a hook
runs when a workflow completes; a proposal is generated from a workflow
session) while the **applicators** are deterministic file writes
(append YAML, write a memory file, edit RULES.yaml). The boundary
inside those primitives mirrors the top-level one: the AI-orchestrated
piece calls into the deterministic-only piece, never re-implements it.

---

## v3 — the `extends` layer (NE-11)

Substrate v3.0.0-beta.1 adds one additive layer: **`extends`**, the
org-scoped content composition primitive. A consumer's
`substrate.config.json` can declare an `extends` array whose entries
contribute substrate content (workflows, hooks, doc-checks, standards,
RULES.yaml rows) into the consumer's effective registry. The repo's
own `substrate/` always wins on collisions.

```json
{
  "extends": [
    { "source": "npm:@acme/substrate-shared", "version": "^2.0.0" },
    { "source": "github:acme-corp/substrate-payments", "ref": "v1.2.0" },
    { "source": "file:../substrate-shared-overrides" }
  ]
}
```

**Three source kinds:**

| Kind     | Resolution                                              | Cache                                  |
| -------- | ------------------------------------------------------- | -------------------------------------- |
| `npm:`   | `node_modules/<pkg>/` (walks up to workspace roots)     | npm install (native)                   |
| `github:`| Clones to `substrate/.cache/extends/github/<slug>/`     | Cache key `<org>-<repo>@<ref>`         |
| `file:`  | Live filesystem; read on every invocation                | none                                   |

**Ordering** mirrors ESLint's `extends`: earlier entries are the base,
later entries override earlier; the consumer's own `substrate/`
overrides all. Same-id workflow / hook / doc-check / rule and
same-relative-path standards collisions all resolve to "later wins."

**Air-gap:** when `SUBSTRATE_OFFLINE=1`, `github:` sources are not
fetched. A warm cache continues to serve; a cold cache surfaces a
`warning` so adopters can mirror via `file:` or a private npm registry.

**CLI:**

- `substrate extends list [--json]` — print the resolved chain with
  per-layer contribution counts + the effective merged registry +
  conflicts.
- `substrate extends sync [--source <id>]` — refresh `github:` caches.
  `npm:` + `file:` sources are skipped.
- `substrate extends clear-cache` — wipe `substrate/.cache/extends/`.

**Backwards compat:** a v2.0 consumer who upgrades to v3.0 and does not
add an `extends` field sees zero behavior change. The resolver's hot
path returns immediately when no `extends` is configured.

The wiring is layered cleanly over v2:

- `src/v2/extends/resolver.ts` — walks the chain; returns ordered roots.
- `src/v2/extends/source-kinds.ts` — file: / npm: / github: dispatch.
- `src/v2/extends/discovery.ts` — wrappers around the v2 discoverers.
- `src/v2/extends/context-merge.ts` — standards + RULES merging.
- `src/v2/deterministic/extends-command.ts` — CLI surface.

The existing v2 single-root discoverers stay untouched — v3 callers
opt into the merged variant when the config declares `extends`.

---

## Reference

- Substrate v2 plan: `docs/plans/substrate-v2-plan.md` (out-of-tree)
- Substrate v3 + extends plan: `docs/plans/substrate-phase-1-2-enterprise-plan.md`
  (out-of-tree)
- v1.0 audit runtime: `docs/audit-runtime.md`
- v1.0 programmatic API: `docs/programmatic-api.md`
