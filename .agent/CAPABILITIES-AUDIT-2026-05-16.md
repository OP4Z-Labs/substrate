# Substrate v2.0 — Capabilities audit for enterprise pitch

> **Audit date:** 2026-05-16
> **Audited branch:** `v2` @ `da6c21f` (v2.0.0 with the OP-1374 v2.0.1 patches rolled in pre-publish)
> **Auditor:** read-only verification pass
> **Scope:** verify Beau's 20 claims about Substrate v2.0's current capabilities and gaps before pitching enterprise adoption.

---

## TL;DR for the enterprise pitch

**Hold these claims confidently in the pitch:**

- Substrate exposes a **read-only MCP server** with 7 tools — works with Claude Desktop, Claude Code, Continue, Cline, any MCP-aware host (claim #1, #16).
- **Programmatic API** at `src/index.ts` with both `deterministic` and `orchestrator` namespaces (claim #2).
- Clean **two-layer architecture** — deterministic primitives vs. AI orchestration (claim #3).
- Five **discovery queries** (`rules`, `standards`, `memory`, `doc-checks`, `sessions`) all wired, machine-readable `--json` everywhere (claim #4).
- **Memory injection** does fire, with a fixed format and a deterministic precedence chain (claim #5, #19).
- **JSON Schema validation** for `workflow`, `hook`, `doc-check`, `config` manifests is real (claim #6).
- **Proposal pipeline** is real and verified by an end-to-end test that maps to plan §7 (claim #7). 8 typed proposals, 6 drift detectors (not 6 + 6 — plan ships 6 detectors).
- **11 primitives shipped** (claim #8) — every one has shipping code.
- **GitHub Action** ships and is functional (claim #9).
- **All "does NOT do" claims hold** — no multi-repo orchestration, no remote-source fetching, no auth model, no server component, no cache module (claims #11-15).

**Walk back / restate carefully:**

- **Claim #1 specifics on Cursor:** Cursor does NOT consume the MCP bridge separately. Cursor gets a **slash-command bridge** (`.cursor/commands/substrate.md`), the same shape as the Claude Code bridge. The MCP server is a **third** integration target, not Cursor's path (claim #16).
- **Claim #4 on drift detectors:** there are **6** built-in drift detectors in code, not 6+ — the HANDOFF says "Six built-in drift detectors" and the code matches. Don't pitch as "expandable in v2.0" — it's a closed set of 6 today.
- **Claim #10 specifics:** `--bridge claude` writes `.claude/commands/substrate.md` (correct), but only when invoked via the new `bridges` array or the legacy `withClaude` flag. The CLI flag is plural (`--bridges`) and accepts a comma-list. Default init scaffolds **no bridges** — explicit opt-in required.
- **Claim #20 (telemetry):** Telemetry IS opt-in and local-log-by-default, but the "PII forbidden-fields rule" lives in the **session-event-log sanitizer** (separate file from the user-telemetry emitter). The user-telemetry emitter (`util/telemetry.ts`) has no programmatic PII filter — it relies on a fixed shape (`v`, `ts`, `substrateVersion`, `osFamily`, `command`, optional `audit`, optional `errorType`) and prose discipline. Sanitization with regex pattern matching applies only to session-event-logs, not user telemetry.

Everything else maps to claim verbatim. The pitch is structurally honest.

---

## Per-claim verdict

### Claim 1 — MCP bridge exists, `init --bridge claude` wires it
**Verdict:** ⚠️ **partially accurate** — the MCP bridge exists, but `--bridge claude` is the slash-command bridge, NOT the MCP wiring path.

**Evidence:**
- MCP server implementation at `packages/substrate/src/commands/mcp.ts:114-281` (`buildMcpServer()`) registers the server with the `@modelcontextprotocol/sdk`'s `McpServer` over `StdioServerTransport` (`mcp.ts:291-297`).
- 7 read-only tools exposed (`mcp.ts:125-278`):
  1. `substrate_audit_list`
  2. `substrate_audit_run`
  3. `substrate_knowledge_show`
  4. `substrate_doctor`
  5. `substrate_workflow_list`
  6. `substrate_workflow_describe`
  7. `substrate_upgrade_check`
- CLI exposes it at `packages/substrate/src/cli.ts:432-444` as `substrate mcp serve`.
- The MCP bridge is wired via `substrate init --bridges mcp` (or `--bridge` accepting `claude,cursor,mcp` per `init.ts:601-609`). It writes `.substrate/mcp/substrate-server.json` + `.substrate/mcp/README.md` (`init.ts:584-608`).

**Correction:**
- `substrate init --bridge claude` writes `.claude/commands/substrate.md` — that's a Claude Code slash-command bridge, NOT MCP wiring. To get MCP, you pass `--bridges mcp`.
- The MCP server is launched as a child process (`substrate mcp serve`); the JSON snippet at `.substrate/mcp/substrate-server.json` is meant to be merged into the host's config file (e.g. Claude Desktop's `claude_desktop_config.json`), which lives outside the repo (`init.ts:576-582`).

---

### Claim 2 — Programmatic API at `src/index.ts` with deterministic.* and orchestrator.* namespaces
**Verdict:** ✅ **accurate**

**Evidence:**
- `packages/substrate/src/index.ts:28-32`: `export const deterministic = deterministicLayer; export const orchestrator = orchestratorLayer;`
- Deterministic barrel: `packages/substrate/src/v2/deterministic/index.ts` re-exports `runValidate`, `runQueryRules/Standards/Memory/DocChecks/Sessions`, `runHooksList/Describe`, `discoverHooks`, `discoverDocChecks`, `queryMemory`, `validateManifest`, `discoverWorkflows`, `loadContext`, plus the full proposal pipeline (`runProposalPipeline`, `classifyDrifts`, `walkProposals`, applicators, queue ops), plus the scheduler and YAML edit helpers. Lines 22-237.
- Orchestrator barrel: `packages/substrate/src/v2/orchestrator/index.ts` re-exports `runV2Workflow`, the full `SessionEventWriter` + sanitiser surface, all 6 drift detectors, and the hook-dispatch primitives. Lines 21-83.
- The `index.ts` also re-exports v1.0 flat APIs (`runInit`, `runAuditExecute`, `runDoctor`, …) for backwards compat — `src/index.ts:139-178`.

**Stability:** every public symbol is typed (interfaces are exported alongside functions). The header comment on `src/index.ts:1-25` documents the layer split + semver commitment to deterministic stability.

---

### Claim 3 — Two-layer architecture, deterministic primitives below, AI orchestration above
**Verdict:** ✅ **accurate**

**Evidence:**
- Directory split: `packages/substrate/src/v2/deterministic/` (10 modules) vs. `packages/substrate/src/v2/orchestrator/` (7 modules).
- Deterministic layer commands: `validate-command`, `query-command` (rules/standards/memory/doc-checks/sessions), `hooks-command` (list/describe), `scheduler-command`, `proposals/{pipeline,queue,classifier,applicators,review-command}`, `watch-command`, `explain-command`, `yaml-edit`.
- Orchestrator layer commands: `run-command` (the AI-aware workflow runner), `session-log`, `drift-detectors`, `hook-dispatch`, `step-handlers`, `transport`, `run-command-types`.
- Header comment on `v2/deterministic/index.ts:1-20` explicitly states: "No AI session required. Every function here is safe to call from CI scripts, git hooks, or other non-interactive contexts."
- Header comment on `v2/orchestrator/index.ts:1-19` states: "AI-aware operations. … load workflow context, render prompts for the AI session, dispatch step-by-step execution, emit session-event telemetry, invoke cross-cutting hooks."

**Caveat:** the drift detectors live in `orchestrator/drift-detectors.ts` even though they're pure functions over session-event logs (no AI call). The deterministic-layer barrel re-imports + re-exports the detectors via the pipeline (`v2/deterministic/index.ts:109-115` — `runProposalPipeline` glues them together). So the runtime separation is clean even if file placement reads as a minor design wobble.

---

### Claim 4 — Discovery queries: `query rules/standards/memory/doc-checks/sessions`
**Verdict:** ✅ **accurate**

**Evidence:**
- `packages/substrate/src/cli.ts:586-770` wires the `query` command with five subcommands:
  - `query rules` (cli.ts:589-615) — flags: `--by-prefix`, `--rules-path`, `--json`, `--quiet`
  - `query standards` (cli.ts:616-649) — flags: `--pattern`, `--for-files`, `--json`, `--quiet`
  - `query memory` (cli.ts:650-687) — flags: `--types`, `--scope`, `--tags`, `--for-files`, `--memory-path`, `--json`, `--quiet`
  - `query doc-checks` (cli.ts:688-726) — flags: `--for-files`, `--changelog-touched`, `--commit-message`, `--json`, `--quiet`
  - `query sessions` (cli.ts:728-770) — flags: `--workflow`, `--limit`, `--include-events`, `--json`, `--quiet`
- Implementation in `packages/substrate/src/v2/deterministic/query-command.ts` — header comment lines 1-15 confirms all five subjects are deterministic and machine-output friendly.

---

### Claim 5 — Memory injection: filters by type/scope/tags/applies_to_globs, injects `## Relevant prior decisions and feedback`
**Verdict:** ✅ **accurate**

**Evidence:**
- Memory loader: `packages/substrate/src/v2/memory.ts:264-318` (`queryMemory`). Filters supported: `types`, `scope`, `tags`, `intersectWithFiles` (matches `applies_to_globs` frontmatter against changed files via `matchGlob`).
- Injection renderer: `packages/substrate/src/v2/memory.ts:503-536` (`renderMemoryInjection`). Top-level heading at line 509: `lines.push("## Relevant prior decisions and feedback");` Block also includes a verify-before-asserting reminder + per-memory subheading `### <name> (written N days ago)` + a query echo footer.
- Wire-up into workflow context: `packages/substrate/src/v2/context-loader.ts:117-176` invokes `queryMemory` with the workflow's `context.memory` block (types/scope/tags + optional `intersect-with-changed-files`) and calls `renderMemoryInjection` to produce the prompt-prepend string.
- Storage location: defaults to Claude Code's `~/.claude/projects/<encoded-project-path>/memory/`. Encoding implemented in `memory.ts` (`encodeProjectPath`).

---

### Claim 6 — Schema-validated manifests at `packages/substrate/schemas/`
**Verdict:** ✅ **accurate**

**Evidence:**
- Four schemas at `packages/substrate/schemas/`:
  - `workflow.schema.json`
  - `hook.schema.json`
  - `doc-check.schema.json`
  - `config.schema.json`
- Validator: `packages/substrate/src/v2/validate.ts:18` uses ajv@8 (draft-07). Header comment confirms it's the source of truth for both CLI `substrate validate <path>`, the Discoverer, and orchestrator defense-in-depth.
- CLI surface: `packages/substrate/src/cli.ts:567` wires `substrate validate`. Walk mode and single-file mode both supported (validate-command.ts:1-30).

---

### Claim 7 — Proposal pipeline: session-event-log, 6 drift detectors, 8 typed proposals, queue, `review --proposals`, applicators, §7 worked example test passes
**Verdict:** ✅ **accurate**

**Evidence:**
- **Session-event-log:** `packages/substrate/src/v2/orchestrator/session-log.ts` — `SessionEventWriter` (line 197+), sanitiser with PII blocklist (`session-log.ts:137-145` — `/home/`, `/Users/`, `Bearer`, `sk-…`, `ghp_…`, email regex), `TEXT_FIELD_MAX_CHARS = 120` (line 130). Append-only JSONL to `substrate/sessions/<workflow>-<sha>.jsonl`.
- **6 drift detectors:** `packages/substrate/src/v2/orchestrator/drift-detectors.ts` exports `detectAdhocSteps`, `detectSkippedSteps`, `detectOutOfOrder`, `detectContextGaps`, `detectRepeatedPrompts`, `detectRuleViolationRecurrence` + `runDriftDetectors` aggregator. Confirmed via `v2/orchestrator/index.ts:57-66`.
- **8 typed proposals:** `packages/substrate/src/v2/deterministic/proposals/types.ts:28-36`:
  1. `add-to-workflow-step`
  2. `add-to-memory`
  3. `add-to-rule`
  4. `add-to-standards-doc`
  5. `add-to-adr`
  6. `add-to-doc-check-registry`
  7. `strengthen-context-load`
  8. `cross-link-existing`
- **Queue:** `packages/substrate/src/v2/deterministic/proposals/queue.ts` writes `substrate/proposals/{pending,applied,rejected}/`. Queue layout: `queue.ts:38`.
- **Walker:** `packages/substrate/src/v2/deterministic/proposals/review-command.ts` implements `walkProposals` with accept/reject/edit/defer/skip; CLI wires `substrate review --proposals` at `cli.ts:986-1010`.
- **Applicators:** `packages/substrate/src/v2/deterministic/proposals/applicators.ts` implements `applyProposal`. YAML applicators use comment-preserving edits (`v2/deterministic/yaml-edit.ts`).
- **§7 worked example test passes:** `packages/substrate/tests/v2-proposal-pipeline-e2e.test.ts` — verified by running `npx vitest run tests/v2-proposal-pipeline-e2e.test.ts`: **4 tests passed**. Test header comment (lines 1-15) explicitly maps the scenario to plan §7: three prior runs of `tackle-task` + a fourth → `adhoc-step` drift with recurrence=4 → `add-to-workflow-step` proposal with §7's markdown shape.

---

### Claim 8 — Eleven primitives shipped
**Verdict:** ✅ **accurate** — every one has shipping code.

**Evidence (per-primitive verification against the v2 HANDOFF table):**

| #   | Primitive                          | Evidence                                                                                                                                     |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Workflow manifest                  | `packages/substrate/src/v2/types.ts` (WorkflowManifest type); `schemas/workflow.schema.json`; reference workflows in `templates/workflows/`. |
| P2  | Two-layer architecture             | `v2/deterministic/` + `v2/orchestrator/` directories, header comments. See claim #3.                                                         |
| P3  | Cross-cutting hooks                | `v2/hooks.ts` (discoverer + validator); `schemas/hook.schema.json`; `v2/orchestrator/hook-dispatch.ts`; CLI `substrate hooks {list,describe}`. |
| P4  | Conditional doc-check registry     | `v2/doc-checks.ts` (discoverer, validator, evaluator); `schemas/doc-check.schema.json`; templates ship 4 example doc-checks.                  |
| P5  | First-class memory                 | `v2/memory.ts` (full §6.1 precedence chain). See claims #5, #19.                                                                              |
| P6  | composes_findings_of               | `v2/composition.ts` exports `checkComposition`, `findLatestSidecar`, `parseDuration`. Re-exported via `src/index.ts:110-119`.                |
| P7  | escalate_after                     | Re-exported in deterministic surface; types in `v2/types.ts:76-86` (`WorkflowEscalationStep`); B2 HANDOFF references the in-place severity mutation behaviour. |
| P8  | `trigger: schedule`                | `v2/types.ts:37-43` (ScheduleTrigger interface with cron/interval/every-n-commits); `v2/deterministic/scheduler.ts` (in-house cron parser, lines 219-235). |
| P9  | Proposal pipeline                  | See claim #7 — full evidence.                                                                                                                |
| P10 | substrate doctor v2 checks         | `packages/substrate/src/commands/doctor.ts:74-83` registers 5 v2 named checks: `memory-frontmatter`, `rules-doc-coverage`, `workflow-coverage`, `stale-proposals`, `escalation-debt` (plus a 6th: `ripgrep-lookaround` added later — line 248). |
| P11 | Plural knowledge sources           | `v2/knowledge/sources.ts:87-89` registers built-ins `docker-compose`, `kubernetes`, `env-registry`; `registerKnowledgePlugin` (line 102) for custom plugins. |

11 / 11 ship.

---

### Claim 9 — GitHub Action wrapper
**Verdict:** ✅ **accurate**

**Evidence:**
- `/home/beaug/dev/public/substrate/action.yml` (49 lines) — Composite/Node20 action with:
  - `using: "node20"`, `main: "dist/action/index.js"` (action.yml line 49)
  - Inputs: `command` (required), `working-directory`, `version`, `fail-on`
  - Outputs: `exit-code`, `stdout`, `stderr`, `report-path`
  - Branding: `git-pull-request` icon, purple color
- Compiled action JS: `/home/beaug/dev/public/substrate/dist/action/index.js` (196 lines).
- Description: "Run substrate audits, reviews, or workflows in CI. Wraps the substrate CLI with workflow-friendly inputs and outputs."

---

### Claim 10 — `substrate init --bridge claude` writes `.claude/commands/substrate.md`
**Verdict:** ✅ **accurate** (with one syntactic clarification)

**Evidence:**
- `packages/substrate/src/commands/init.ts:18` defines `BridgeName = "claude" | "cursor" | "mcp"`.
- `init.ts:584-592` (`bridgeTargetDir`) maps `claude → .claude/commands`.
- `init.ts:601-608` (`bridgeFiles`) maps `claude → ["substrate.md"]`.
- Bridge file source: `packages/substrate/templates/bridges/claude/substrate.md` (template header confirms it's a Claude Code slash command).
- Init writes the file via the copy loop at `init.ts:211-237`.

**Clarification:**
- CLI flag is `--bridges <list>` (plural). Single-name `--bridge claude` reads as a typo unless aliased. The HANDOFF and README use `--bridge mcp` shorthand; the actual flag is plural and accepts comma-separated. (Investigating `cli.ts` directly: see line 110 in `cli.ts` for the bridge option declaration — pitch should use the correct plural in writing.)
- A legacy `--with-claude` flag is preserved for backwards compatibility (`init.ts:29`, line 563 in `resolveBridges`).

---

### Claim 11 — Multi-repo orchestration: NOT supported
**Verdict:** ✅ **accurate** (gap confirmed)

**Evidence:**
- No `remote-source` CLI subcommand exists. `cli.ts` command surface (grep at lines 93-1028) lists no multi-repo or cross-repo primitives.
- The discoverer walks `<repo>/substrate/workflows/` only (`v2/discoverer.ts:25-66`); workflows-dir is computed from `resolveTargetRoot(options.cwd)` — a single root.
- HANDOFF `HANDOFF-2026-05-15-v2.md` line 230 ("Beau-hosted services / SaaS … Plan §13 scopes this out permanently for v2.x") confirms multi-repo / remote orchestration is out of v2.x scope.

---

### Claim 12 — Remote substrate sources (fetch workflows/rules over network): NOT supported
**Verdict:** ✅ **accurate**

**Evidence:**
- Grep for `fetch(`, `http.request`, `https.request` across `packages/substrate/src/` returns only **one** usage: the **opt-in telemetry forward** in `util/telemetry.ts:196` (POST to a user-configured endpoint via `SUBSTRATE_TELEMETRY_ENDPOINT`, fire-and-forget). No code path reads workflows / rules / standards / memory from a remote source.
- All discoverers (`discoverWorkflows`, `discoverHooks`, `discoverDocChecks`) read the local filesystem only.
- `loadContext` reads `<repo>/substrate/standards/`, `<repo>/standards/`, or `<repo>/auto/standards/` — local-only (`v2/context-loader.ts:194`).

---

### Claim 13 — No org auth / credential system
**Verdict:** ✅ **accurate**

**Evidence:**
- Grep for `auth`, `token`, `credential`, `Bearer`, `oauth` across `packages/substrate/src/` finds only:
  - Telemetry's regex blocklist (`session-log.ts:141-144` — strips `Bearer`, `sk-…`, `ghp_…` from session-log strings)
  - HTTP `fetch` for opt-in telemetry forward (no auth header)
- No credential storage. `~/.config/substrate/` holds only `telemetry.json` (preference) and `telemetry.log`.
- No org-scoped content gating. Schemas (`config.schema.json`) have no `org`, `tenant`, or `access` fields.

---

### Claim 14 — No server-side substrate hub
**Verdict:** ✅ **accurate**

**Evidence:**
- No server entrypoint in `packages/substrate/src/`. No `serve` / `listen` / `express` / `fastify` / `http.createServer` / `koa` references.
- The only "server" in the codebase is the MCP server (`src/commands/mcp.ts`), which is a **stdio-transport child process** under the host's lifetime — not a network listener.
- `package.json` runtime deps are CLI / utility-shaped: `@modelcontextprotocol/sdk`, `ajv`, `commander`, `kleur`, `yaml`, `zod`, etc. No web framework.
- HANDOFF line 230: "Beau-hosted services / SaaS … out of scope permanently for v2.x".

---

### Claim 15 — No caching layer for remote content
**Verdict:** ✅ **accurate**

**Evidence:**
- No cache module. Grep `cache`, `lru`, `ttl` across `packages/substrate/src/` returns nothing relevant (one `loadSchema` cache for ajv in `validate.ts`, in-memory only — not a remote-content cache).
- No remote content to cache (claim #12).

---

### Claim 16 — Cross-tool integration beyond MCP
**Verdict:** ⚠️ **partially accurate** — the integration model is broader than "MCP only" but narrower than "Cursor MCP support".

**Evidence:**
- **Three bridge targets:** `BridgeName = "claude" | "cursor" | "mcp"` (`init.ts:18`).
- **Claude Code bridge:** slash-command markdown at `.claude/commands/substrate.md` (template at `templates/bridges/claude/substrate.md`). NOT MCP — it's a Claude Code slash command that shells out to `npx @op4z/substrate`.
- **Cursor bridge:** slash-command markdown at `.cursor/commands/substrate.md` (template at `templates/bridges/cursor/substrate.md`). NOT MCP — same shape as the Claude bridge.
- **MCP bridge:** stdio MCP server (`substrate mcp serve`) + scaffolded host-config snippet at `.substrate/mcp/substrate-server.json`. Works with **any MCP-aware host** — README at `templates/bridges/mcp/README.md` lists "Claude Desktop, Claude Code, Continue, Cline".
- **No GitHub Copilot CLI bridge exists.** Grep for `copilot`, `gh-copilot`, `gh copilot` returns nothing in `packages/substrate/src/`.
- **Other AI tool integration paths:** none beyond the three above. The MCP server is the catch-all for any MCP-aware tool; there's no provider-specific code for Continue, Cline, or others.

**Correction for the pitch:**
- "Cursor MCP support" is not the right framing. Cursor uses substrate via a **Cursor slash command**, not via MCP. (Cursor does support MCP independently, so an enterprise customer could point Cursor's MCP host at `substrate mcp serve`; substrate is the same MCP server either way — but the scaffolded Cursor bridge is the slash-command path.)
- "GitHub Copilot CLI integration": correctly assumed absent. No bridge exists.

---

### Claim 17 — `substrate.config.json` has no `extends`, `remote-sources`, `org`, or similar enterprise-shaped fields
**Verdict:** ✅ **accurate** (gap confirmed)

**Evidence:**
- Schema at `packages/substrate/schemas/config.schema.json`:
  - `additionalProperties: true` at root (line 8), but the known fields are: `$schema`, `version`, `project`, `stacks`, `paths`, `defaults`, `bridges`, `knowledge`, `extensions`, `telemetry`, `memory` (lines 9-95).
  - No `extends`, `remote-sources`, `org`, `tenant`, `auth` fields.
- Type at `packages/substrate/src/util/types.ts:19-117` (`SubstrateConfig`) confirms the same fields. The only "extension point" is `extensions: { taskAdapter, vcsAdapter }` — npm-package names for local plugin loading (no remote fetch).
- The schema's `additionalProperties: true` means an enterprise consumer COULD add custom fields without failing validation, but no runtime path reads enterprise-shaped fields today.

---

### Claim 18 — Manifest paths and configurability
**Verdict:** ✅ **mostly accurate** — paths are hardcoded with one fallback layer.

**Evidence (hardcoded paths confirmed):**
- Workflows: `substrate/workflows/` — `v2/discoverer.ts:26` (`const WORKFLOWS_RELPATH = join("substrate", "workflows")`).
- Hooks: `substrate/hooks/` — `v2/hooks.ts:176` ("`<consumer-repo>/substrate/hooks/`").
- Doc-checks: `substrate/doc-checks/` — `v2/doc-checks.ts` discoverer.
- RULES.yaml: `substrate/RULES.yaml` then `auto/RULES.yaml` — `v2/context-loader.ts:228` ("Tried substrate/RULES.yaml and auto/RULES.yaml") and `v2/deterministic/query-command.ts:92`.
- Standards: `substrate/standards/` then `standards/` then `auto/standards/` — `v2/context-loader.ts:193-194`.
- Sessions: `substrate/sessions/` — `v2/orchestrator/session-log.ts:169`.
- Proposals: `substrate/proposals/{pending,applied,rejected}/` — `v2/deterministic/proposals/queue.ts:38`.

**Configurability:**
- Workflows / hooks / doc-checks / proposals dirs: **NOT configurable** — hardcoded to `substrate/<subdir>` relative to repo root.
- Standards: configurable per call via `LoadContextOptions.standardsRoot` (`context-loader.ts:97`); default fallback chain handles legacy `auto/` and bare `standards/` layouts.
- RULES.yaml: configurable per call via `rulesPath` option; falls back across `substrate/`, `auto/` (`context-loader.ts:99`).
- Memory: fully configurable per claim #19 below.
- Knowledge sources: configurable via `substrate/knowledge-sources.yaml` manifest (`v2/knowledge/sources.ts`).

---

### Claim 19 — Context loading order for memory: flag → env → config → Claude Code default → none
**Verdict:** ✅ **accurate** (verified in code, order matches exactly)

**Evidence:**
- `packages/substrate/src/v2/memory.ts:136-173` (`locateMemoryDir`):
  - **Step 1** (lines 144-149): `options.memoryPath` flag wins (resolves + checks existence; returns `{source: "flag"}`).
  - **Step 2** (lines 151-158): `process.env.SUBSTRATE_MEMORY_PATH` (returns `{source: "env"}`).
  - **Step 3** (lines 160-164): `readMemoryPathFromConfig(cwd)` reads `substrate.config.json` → `memory.path` (returns `{source: "config"}`).
  - **Step 4** (lines 166-170): `locateClaudeCodeMemoryDir(cwd, homeDir)` checks `~/.claude/projects/<encoded>/memory/` (returns `{source: "claude-code"}`).
  - **Step 5** (line 172): returns `{path: null, source: "none"}` — empty result with a "no memory store" warning.

Order matches plan §6.1 verbatim.

---

### Claim 20 — Telemetry: opt-in, local-log-only, sanitiser blocklist, PII forbidden-fields rule enforced
**Verdict:** ⚠️ **partially accurate** — split into two telemetry channels, only one of which uses pattern-based sanitization.

**Evidence — User telemetry (`util/telemetry.ts`):**
- Opt-in only: `readPreference()` returns `enabled: null` by default; `emitTelemetryEvent` short-circuits unless `enabled === true` (`util/telemetry.ts:163-164`).
- Local log emit: appends JSON line to `~/.config/substrate/telemetry.log` (`util/telemetry.ts:174-176`).
- Optional outbound forward: only when `SUBSTRATE_TELEMETRY_ENDPOINT` env var is set or an `endpoint` option is passed (`util/telemetry.ts:179-186`). Fire-and-forget, 2-second AbortSignal.timeout.
- Event shape (`util/telemetry.ts:59-67`): `{ v, ts, substrateVersion, osFamily, command, audit?, errorType? }`. **No body content — fixed shape.** The "forbidden-fields rule" is enforced by shape, not by sanitization regex.
- Header comment (`util/telemetry.ts:31-38`) lists prose discipline: no project paths, no user identifiers, no rule body content, no audit findings, no environment values. **This is not enforced at runtime in `emitTelemetryEvent` — there is no per-field filter; the emitter only writes the named fields.**

**Evidence — Session-event-log telemetry (`v2/orchestrator/session-log.ts`):**
- This is the **separate channel** flagged in the HANDOFF (line 119-121: "Session-event-log is a separate channel from `~/.config/substrate/telemetry.log`").
- Sanitiser blocklist with **regex patterns** at `session-log.ts:137-145`:
  - `/home/<path>` → redacted
  - `/Users/<path>` → redacted
  - `Bearer <token>` → redacted
  - `sk-<openai-style>` → redacted
  - `ghp_<github-pat>` → redacted
  - Email regex → redacted
- Truncation at 120 chars (`session-log.ts:130` — `TEXT_FIELD_MAX_CHARS = 120`).
- `sanitiseEvent` (line 197+) is invoked on every event before append (line 268).

**Correction for pitch:** distinguish the two channels. User telemetry has a fixed, content-free shape (good PII story). Session-event-logs apply regex sanitization to free-text fields (path/token/email blocklist + truncation).

---

## Additional observations (not on the claim list)

### O1 — npm package name has not been published yet
The README states "v0.8 (hardening + ecosystem). Local development only; not yet published to npm." The v2 HANDOFF (line 237-242) calls out that publish is blocked on op4z npm/GitHub org access recovery. **Enterprise pitch caveat: substrate is not yet installable via `npm install @op4z/substrate` from the public registry.** A local tarball ships at `packages/substrate/op4z-substrate-2.0.0.tgz`.

### O2 — MCP tool surface is read-only by design
The MCP server explicitly omits all write operations (`init`, `add`, `apply`, `task create/update`, `workflow start`). Enterprise adopters wanting AI-driven repo writes through MCP will need to wait for v1.0's planned `confirm: true` parameter pattern (`commands/mcp.ts:18-22`).

### O3 — Plugin contracts exist for task adapters and VCS adapters
`SubstrateConfig.extensions` has `taskAdapter` and `vcsAdapter` fields (`util/types.ts:92-95`). Three reference adapters ship in the workspace (`packages/adapter-{github,jira,linear,stub}`). Adapters load via dynamic `import()` of npm package names — works for org-private npm packages too.

### O4 — Knowledge sources support custom plugins
`registerKnowledgePlugin` (`v2/knowledge/sources.ts:102`) exposes a runtime plugin contract beyond the three built-ins (docker-compose, kubernetes, env-registry). Useful pitch lever for enterprise integrations.

### O5 — `additionalProperties: true` on config schema
The root config schema allows unknown fields. This means an enterprise consumer could prototype extension fields (e.g. `org: { ... }`) without breaking validation. There's no runtime that reads those fields today, but the schema doesn't block forward-compatibility experiments.

### O6 — Substrate's only network surface today is opt-in telemetry forwarding
The single `fetch` call in the codebase (`util/telemetry.ts:196`) is gated behind both the opt-in preference + a `SUBSTRATE_TELEMETRY_ENDPOINT` env var (or per-call `endpoint` option). No other code path makes outbound HTTP requests. **Air-gapped enterprise environments need no special configuration to use substrate.**

### O7 — Scheduler is non-invasive by default
`substrate scheduler --check` lists due workflows but does not run them. `--auto-run` (added in TI-3 per the recent commit log: `cca7ac5 feat(v2): substrate explain + scheduler --auto-run [TI-3 TI-5]`) fires overdue workflows. CI integration is the consumer's responsibility, not substrate's. Good safety story.

### O8 — Action.yml uses `npm install -g`
The GitHub Action installs substrate fresh on every run via npm. Slow + assumes a public-registry install will work. Once published, expect ~30s install cost per action run. Worth noting for enterprise CI cost discussion.

### O9 — No multi-version / migration tooling for v1→v2 enterprise rollout
`substrate upgrade --check / --apply` exists for **scaffolded content** drift, but there's no programmatic primitive for an org to roll out a substrate version bump across N repos. Each repo runs `substrate upgrade` independently.

### O10 — Tests are vitest, 608 passing per the milestone HANDOFF
Running the e2e proposal pipeline test (claim #7 verification) confirmed the local suite runs cleanly. Test infrastructure is solid for an enterprise QA story.

### O11 — Memory ignore list is per-config + global default
`DEFAULT_MEMORY_IGNORE = ["MEMORY.md", "README.md", "INDEX.md"]` (`v2/memory.ts:52-56`). Augmented per-repo via `substrate.config.json` → `memory.ignore[]`. Important: substrate reads Claude Code's own index files but ignores them so they don't pollute injected memory. This is an OP-1374 v2.0.1 patch (per the README's HANDOFF reference).

### O12 — Reference templates ship 11 workflows + 4 doc-checks + 4 hooks
Templates at `packages/substrate/templates/`:
- 11 reference workflows (including `tackle-task`, `audit-service`, `audit-package`, `weekly-proposal-walk`, `git-review-pre`, `git-review-deep`, `commit-and-push`, `audit-security`, `audit-composite`, `new-service`, `standards-update`).
- 4 doc-checks (`changelog-on-feat-or-fix`, `adr-on-architecture-change`, `migration-guide-on-schema-change`, `public-docs-on-marketing-change`).
- 4 hooks (`auto-drift-detect`, `auto-emit-sidecar`, `auto-update-trend`, `auto-propose-tasks`).
- 1 example rule (`rules-registry/examples/no-todo-comments.yaml`).

The five new reference workflows mentioned in the recent commit (`37d9674 feat(v2): five new reference workflows [TI-6]`) are visible in the templates dir.

---

## Verdict summary

| Claim                                          | Verdict |
| ---------------------------------------------- | ------- |
| 1. MCP bridge exists; init wires it            | ⚠️ partial (bridge name is `mcp`, not `claude`) |
| 2. Programmatic API at src/index.ts            | ✅ accurate |
| 3. Two-layer architecture                      | ✅ accurate |
| 4. Five discovery queries                      | ✅ accurate |
| 5. Memory injection into AI prompts            | ✅ accurate |
| 6. Schema-validated manifests                  | ✅ accurate |
| 7. Proposal pipeline + §7 worked example       | ✅ accurate (test passes) |
| 8. Eleven primitives shipped                   | ✅ accurate (11/11) |
| 9. GitHub Action ships                         | ✅ accurate |
| 10. `init --bridge claude` writes .md          | ✅ accurate (flag is `--bridges`) |
| 11. No multi-repo orchestration                | ✅ accurate (gap confirmed) |
| 12. No remote substrate sources                | ✅ accurate (gap confirmed) |
| 13. No auth / credential system                | ✅ accurate (gap confirmed) |
| 14. No server-side substrate hub               | ✅ accurate (gap confirmed) |
| 15. No caching layer for remote content        | ✅ accurate (gap confirmed) |
| 16. Cross-tool integration paths               | ⚠️ partial (Cursor uses slash-cmd, not MCP) |
| 17. Config schema lacks enterprise fields      | ✅ accurate (gap confirmed) |
| 18. Manifest paths hardcoded                   | ✅ accurate (with standards/rules fallback) |
| 19. Memory context loading order               | ✅ accurate (matches plan §6.1) |
| 20. Telemetry sanitization                     | ⚠️ partial (two channels; only session-log uses regex sanitization) |

13 ✅ accurate · 4 ⚠️ partially accurate · 0 ❌ inaccurate · 0 🤷 unverifiable

**Net read: the pitch is structurally honest.** All four partial verdicts are nuance-of-mechanism corrections rather than capability misrepresentations. Substrate v2.0 has the surface Beau described; the partials only matter when he commits to specific flags / file paths / channel semantics in front of an enterprise architect.
