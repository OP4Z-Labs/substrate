# Substrate v3 — Exploration & Recommendations

> **Date:** 2026-05-15
> **Mode:** Read-only exploration; no code changes
> **Reviewer:** Claude (Opus 4.7 / 1M ctx)
> **Sources read:** v2 plan §1-13, inventory §6 + §7, v2 milestone HANDOFF, per-phase HANDOFFs (B1-B4), smoke + smoke-fix reports, full v2 codebase under `packages/substrate/src/v2/`, `templates/`, adapter packages, docs-site pages.

---

## Executive summary

**Top v3 directions (ranked by leverage):**

1. **AI-step engine — finish the orchestrator.** Today every step type that isn't `invoke-deterministic` / `run-tool` returns `deferred` with the message "requires the B2 step engine" (see `src/v2/orchestrator/run-command.ts:355-366`). That's six step types (`prompt`, `prompt-and-action`, `invoke-sub-workflow`, `gate`, `discover`, `propose-doc-change`) — i.e. every step type that isn't a shell-out. The proposal pipeline runs against session-event-logs that, in production, will be almost entirely deterministic-shell runs. The drift detectors' headline value lights up only when real AI steps populate `prompt-issued`, `step-confirm`, and `adhoc-step` events. Until this lands, drift detection is gated on consumers (Claude Code) being kind enough to emit those events themselves — which is fragile. **This is the single biggest leverage point in v3.**

2. **Live mode (file-watcher) — close the `file-change` trigger stub.** `HookTrigger` declares `file-change` but no code path fires it (verified by grep across the entire src tree — only the type definition mentions it). Hooks-on-save is a high-value developer-loop primitive that composes directly with existing hooks; the wiring exists, just no producer.

3. **Reverse proposal pipeline — workflow synthesis from session history.** v2 proposes edits to *existing* workflows. v3 should also propose *new* workflows: if the same sequence of ad-hoc steps recurs across multiple sessions outside any workflow, that's a synthesis signal. Same drift engine, opposite direction.

4. **Standards-doc dependency graph + drift-aware doctor.** When a standards doc is updated, no system tracks what rules/workflows/memories reference it. v3 should produce an explicit reverse index so `substrate doctor` can warn "you edited `backend/python.md` but BE-PY-001 still references the old section heading" and `substrate review --doc-drift` could walk that.

5. **The `describe` surface gap is bigger than it looks.** The smoke-fix observation #2 noted that `substrate workflow describe` for v2 workflows compresses information (no first-class v2-aware describe). But the gap is deeper: there's no way to ask "what would `substrate run X` actually load?" without running it. A `substrate explain <workflow>` command that dry-runs context loading and prints the rendered prompt the AI would see is the missing inspection primitive — and it'd let workflow authors iterate on context tuning without launching a session.

**Honest assessment:** v3 is **not** a near-term need driven by user demand — there is no user demand yet (v2 not even published). v3 is the right pass when (a) real consumers have run v2 against real repos for 3-6 months, (b) the proposal pipeline has accumulated enough signal to know which proposal kinds matter and which were dead weight, and (c) the AI-step engine actually exists so the headline differentiator can be exercised. Some items below (the AI-step engine in particular) feel less like "v3 expansion" and more like "v2.1 — finish what v2 started." The phasing recommendation below reflects that.

**Recommended phasing:**
- **v2.1 (1-2 months after v2.0 publish):** the AI-step engine, the `file-change` trigger producer, `substrate explain`, the v2-aware `workflow describe`, the ripgrep look-around fix. These are deferred-v2 items, not v3 ambitions.
- **v3.0 (after 6+ months of real consumer signal):** reverse proposal pipeline, standards-doc dependency graph, workflow composition as a graph (not list), tree-sitter detectors, cross-workflow memory propagation. These need observed-usage data to design well.
- **Defer to v4 / never:** visual UI for proposals, Substrate-native memory backend, multi-repo orchestration. The plan §13 explicitly scoped these out and the v2 ship validates that decision.

---

## Targeted improvements (close known gaps)

### TI-1 — Finish the AI-step engine (orchestrator's six deferred step types)

- **What:** `runStep` in `src/v2/orchestrator/run-command.ts:350-368` returns `status: "deferred"` for `prompt`, `prompt-and-action`, `invoke-sub-workflow`, `gate`, `discover`, `propose-doc-change`. The orchestrator runs deterministic shell-outs only.
- **Why it matters:** Every reference workflow that isn't pure-deterministic falls back to "AI-step orchestration lands in B2" — and B2 already shipped. The deferred message is a v2.0 architectural lie: those step types are documented, validated, type-safe, and untestable end-to-end. Beau's stated value proposition ("AI as orchestration runtime") cannot be realised until these steps actually run.
- **Approach sketch:** Each deferred step type is a discrete unit of work:
  - `prompt` — emit a `prompt-issued` event; flush the loaded context + the prompt body to a transport (Claude Code SDK / Cursor MCP / stdout when no AI is attached); poll for response; emit `step-confirm` if `must-confirm: true`.
  - `prompt-and-action` — same as prompt, but the AI's response is expected to mutate the working tree; emit `step-completion` with a brief.
  - `invoke-sub-workflow` — recursive `runV2Workflow` call with a synthetic correlation id stitching parent + child session-event-logs.
  - `gate` — wait on user input via the same transport; the gate's exit code informs the workflow's overall verdict.
  - `discover` — programmatic context discovery step (delegate to `loadContext` with the step's own filter overrides); useful when context shifts mid-workflow.
  - `propose-doc-change` — generate a markdown diff against a doc the workflow declares; route through the same applicator dispatch the proposal pipeline uses, but proposal-source is `step`, not `drift`.
  - The transport layer is the crux. v2 already names three (Claude Code, Cursor, MCP). v3 should formalize an `OrchestrationTransport` interface with `emitPrompt`, `awaitResponse`, `presentDiff`, `confirm` and ship adapters for each.
- **Composability:** Uses every existing v2 primitive — session-event-log (P9 component A becomes much richer), context-loader (P5), hooks (P3 — workflow-step-completion now fires for AI steps too), composition (P6), the proposal pipeline (P9 — finally exercises `context-gap`, `repeated-prompt`, `adhoc-step` from real sessions instead of hand-crafted fixtures).
- **Effort:** 2-4 weeks. The transport interface is the design tax; once chosen, each step type is a small addition.
- **Risk:** The transport interface is a v3 ABI commitment. Get it wrong and either consumers can't integrate (too rigid) or `OrchestrationTransport` becomes a god-interface (too loose). Mitigate by shipping one adapter (Claude Code) first with the interface intentionally underspecified; harden in v3.1.
- **Priority:** **must-have-v3** (or v2.1 — see phasing).

### TI-2 — Wire the `file-change` HookTrigger

- **What:** `HookTrigger` includes `file-change` (`src/v2/hooks.ts:36`) but no code path produces this event. Reference verified by grep: zero non-type-definition references across `src/`.
- **Why it matters:** Live development is the AI-coding-agent loop's killer affordance ("save a Python file → backend/python.md gets re-loaded into Claude's context"). Without it, workflows are batch operations — useful but stale.
- **Approach sketch:** Two implementation paths:
  - **(a) `substrate watch` — long-running daemon.** Walks `substrate/workflows/`, registers `chokidar` watchers for `when.files-changed-any` patterns, fires matching hooks on each save event. Trade-off: another long-running process to manage.
  - **(b) Per-editor integration — same-process trigger.** Claude Code's MCP / Cursor's command surface both have file-save callbacks. v3 ships an MCP tool `substrate_on_file_change` that editors call on every save; substrate matches workflows + dispatches hooks. No daemon required.
  - Recommend (b) for v3.0; (a) optionally later. (b) composes with the editor's existing watch infrastructure instead of duplicating it.
- **Composability:** P3 (cross-cutting hooks) gains a new trigger. The proposal pipeline picks up `file-change`-triggered sessions automatically.
- **Effort:** 1-2 days for (b); 1 week for (a) including daemon lifecycle.
- **Risk:** (a) is a long-running process with state — implies error handling, restart-on-config-change, log rotation. (b) puts substrate in the editor's hot path, so it must be fast (<50ms per save).
- **Priority:** **must-have-v3**.

### TI-3 — `substrate explain <workflow>` (the missing inspection primitive)

- **What:** A new command that loads context exactly as `substrate run` would, then prints the rendered prompt block + context summary, without invoking any step. Different from `substrate validate` (schema only) and `substrate workflow describe` (manifest only).
- **Why it matters:** Workflow authoring today requires "guess what context loads → run the workflow → infer from output". `substrate explain tackle-task --as-of HEAD` would print the standards loaded, memories matched, rules filtered, knowledge sections, and the prompt-injection block. Closes the smoke-fix observation #2 (v2-aware describe surface gap) with the right shape.
- **Approach sketch:** New command in `src/cli.ts` + `src/v2/deterministic/explain-command.ts`. Wraps `loadContext` + the orchestrator's prompt-render helpers (which today are inline in `run-command.ts`'s context-loaded event emission; extract to a pure function).
- **Composability:** Pure-deterministic. Uses P1 (manifest), P5 (memory), context-loader.
- **Effort:** 1-2 days.
- **Risk:** Forces extraction of the prompt-rendering logic out of `run-command.ts`. That's good hygiene anyway — the orchestrator should compose primitives, not own them.
- **Priority:** **must-have-v3**.

### TI-4 — Replace ripgrep look-around regexes (RULES catalog)

- **What:** Smoke-fix observation #1: bundled RULES.yaml uses `(?:…)` / `(?!…)` regexes that fail under ripgrep without `--pcre2`. Affects BE-APIV-001, FE-TS-001, XCUT-MD-001 today; pattern likely to recur as the catalog grows.
- **Why it matters:** Every `substrate audit` on a freshly-initted repo prints regex errors. Bad first impression; trains users to ignore `substrate audit` warnings.
- **Approach sketch:** Two options:
  - **(a) Rewrite patterns** without look-around. For path exclusions, ripgrep has `--glob` (`-g`); for negative lookahead, often a separate detector composed via `composite.ts` does the job.
  - **(b) Auto-pass `--pcre2`** when a detector pattern contains `(?` and `rg --pcre2` is available. Fall back to a clear warning when not.
  - Prefer (b) for the catalog; (a) for templates so user-authored RULES.yaml works without the flag.
- **Composability:** Touches only `src/audit/detectors/ripgrep.ts`.
- **Effort:** 1-2 days.
- **Risk:** `--pcre2` isn't always compiled into ripgrep binaries (especially Alpine / minimal CI images). Detect availability at probe time alongside the existing `hasRipgrep()`.
- **Priority:** **nice-to-have-v3** (smoke-fix observation; cosmetic-ish but cumulatively eroding).

### TI-5 — `substrate scheduler --auto-run` (close the scheduling loop)

- **What:** Today's scheduler is read-only by design (`substrate scheduler --check` lists, never runs; v2 plan §3.8 + §13 explicitly scope this out). For v3 the question is whether to relax.
- **Why it matters:** A weekly proposal walk that requires the user to manually pipe `substrate scheduler --check | xargs substrate run` (today's documented pattern in `docs/scheduling.md`) is the wrong friction point for an "engine that watches itself" headline. Without auto-run, scheduled workflows don't actually run — they get listed.
- **Approach sketch:** `substrate scheduler --auto-run [--max-runs N]` — invokes `runV2Workflow` for each due workflow up to N. The state file (`substrate/scheduler/state.json`) already tracks last-run; auto-run just calls `recordWorkflowRun` after each invocation. Add a `--quiet` and `--json` for CI consumption.
- **Composability:** Pure composition of P8 (schedule trigger) + the orchestrator.
- **Effort:** 2-3 days including documentation of the "what if a workflow hangs" semantics.
- **Risk:** Plan §13 explicitly says "v2.0 stays local-log-only". Auto-run breaks that promise lightly — the local cron / CI invocation pattern was the explicit constraint. Verify Beau's stance before shipping. If still off-limits, leave to v3.1+.
- **Priority:** **nice-to-have-v3** (genuinely-deferred-by-design — needs decision).

### TI-6 — Workflow templates: thin reference set

- **What:** The shipped `templates/workflows/` is 5 manifests + the `weekly-proposal-walk` reference + the (now-fixed) `new-service`. None of these cover: pre-merge gate (the OP4Z `/run git --review-pre` shape), release-management workflows, security audits as a workflow (substrate ships a security audit detector pass but not a wrapping workflow), or onboarding-/handoff-style workflows.
- **Why it matters:** First-time consumers see 5 templates and copy whichever matches their use case. The reference set is the visible API of v2 for most users.
- **Approach sketch:** Add 3-4 more reference workflows:
  - `pre-merge-gate.yaml` — runs audit + doctor + composes findings, gates on conditional doc-checks
  - `release-prep.yaml` — bumps version, updates CHANGELOG via doc-checks, gates on stale-proposals
  - `audit-security.yaml` — wraps the security detector pass with composition into the audit-composite workflow
  - `onboard-handoff.yaml` — runs `substrate explain` over the active workflow set, generates a primer markdown
- **Composability:** No new primitives. Just reference content.
- **Effort:** 1-2 days per workflow.
- **Risk:** Low. Worst case: templates feel opinionated; consumers fork.
- **Priority:** **nice-to-have-v3**.

---

## Novel expansions (net-new capabilities)

### NE-1 — Reverse proposal pipeline: workflow synthesis from drift

- **What:** v2 proposes edits to *existing* workflows when drift recurs. v3 should also propose *new workflows* when the same sequence of ad-hoc actions recurs across sessions that ran outside any workflow. Same drift engine, opposite direction.
- **Why it matters:** This is the natural extension of the v2 thesis. "The engine that watches its own runs" is incomplete if it only fires when there's already a workflow. Real users start with no workflows; the engine should see "you ran `pytest` → `git diff` → `git commit` 5 times this week, want a workflow for that?" That's the v2 proposal pipeline rotated 90 degrees.
- **Approach sketch:** Session-event-logs today are written only inside `substrate run`. Extend: when no workflow is running but substrate's bridge is active, capture a passive event-log of the AI session's tool calls. Run a new drift detector — `recurring-sequence` — across the passive logs. When a sequence recurs ≥3 times, emit a new proposal kind: `add-workflow`. The applicator scaffolds a new `substrate/workflows/<inferred-id>.yaml` from the captured sequence + a stub body.
- **Composability:** Massive — reuses session-event-log infrastructure, the proposal queue, the applicator dispatch. New: passive session capture, the `add-workflow` proposal kind, the workflow-synthesis applicator.
- **Effort:** 3-4 weeks. The capture-when-not-running surface is genuinely new; everything downstream of it is composition of v2 primitives.
- **Risk:** Passive capture has privacy implications (sanitizer blocklist applies, but the user's tool-call sequence is itself signal). Plan §13 explicitly excluded a Beau-hosted collector; this stays local-log-only, but consumers need a clear opt-in flag and a `substrate sessions --redact` review surface. The biggest design question: how does substrate get the passive event-log when there's no `substrate run`? Answer is either (a) an MCP tool the editor calls per-tool-use, or (b) a Claude Code hook that pipes stdin events. Both feasible; (a) likelier to compose with the v3.0 transport story.
- **Priority:** **must-have-v3** — this is the v3 headline differentiator analogous to v2's proposal pipeline. Be honest about scope.

### NE-2 — Workflows as a queryable graph (composition expands)

- **What:** Today, `composes_findings_of` is a list of upstream workflows (P6). It's a flat dependency. v3 should expose the workflow set as a directed graph and let consumers query it: "what workflows depend on `audit-service`?" "what workflows load `backend/python.md`?" "show me the workflows that fire on commit-message-pattern `feat.*`."
- **Why it matters:** With 10+ workflows in a real consumer, discovery becomes the limiting factor. The composition relationship is already encoded; surfacing it would let users (and the AI session) reason about workflow topology without reading every manifest. Also closes the inventory open observation #6 ("`/run` is heavily AI-aware but `./exc` is not" — a queryable graph makes both AI and shell discovery first-class).
- **Approach sketch:** New deterministic command `substrate query graph [--from <id>] [--to <id>] [--loads <standards-path>]`. Walks `discoverWorkflows`, builds an in-memory graph (nodes = workflows, edges = `composes_findings_of` + `invoke-sub-workflow` targets), filters by query, renders as text (default), JSON, or DOT (for graphviz).
- **Composability:** Pure additive on P6 + P1.
- **Effort:** 3-5 days.
- **Risk:** Low. Worst case: the graph view exposes that workflows aren't actually composing much, which would be a useful signal in its own right.
- **Priority:** **nice-to-have-v3**.

### NE-3 — Standards-doc dependency graph + drift-aware doctor

- **What:** Standards docs are referenced from rules (`doc:` field), workflows (`context.standards`), and memories (`related_rules` indirectly). When a standards doc is edited, no system tracks what depends on it. v3 should produce an explicit reverse index.
- **Why it matters:** OP4Z inventory observation #5 + Gap 8: rules without docs backing, docs without rules linking. The reverse index closes that. A `substrate doctor` check `standards-drift` could warn "you edited `backend/python.md` 30 days ago but BE-PY-001's `doc:` line references section heading 'Old async pattern' which no longer exists in the file."
- **Approach sketch:** Build-time index (cheap; ~100 docs). For each standards doc, parse markdown headings, build `{ path → headings[] }`. For each rule, parse the `doc:` field (path + optional `#anchor`). For each workflow, parse `context.standards`. Walk references and emit a `standards-references.json` sidecar. Doctor check reads the sidecar + diffs against current file state.
- **Composability:** Extends P10 (doctor). New deterministic primitive: `buildStandardsReferences`.
- **Effort:** 3-5 days. Markdown heading parsing is the only new thing.
- **Risk:** Low. The index can go stale (user edits doc without rebuilding); same staleness model as `composes_findings_of` solves it (declare freshness window; doctor warns).
- **Priority:** **must-have-v3** — this is the natural extension of v2's "engine that watches its own drift" thesis, applied to standards.

### NE-4 — Tree-sitter / AST-aware detector kind

- **What:** Today's detectors: `ripgrep` (regex), `script` (user JS), `composite` (combines findings). For a rule like "no `print()` in production code, but `print()` in tests is fine" or "every async DB query must include `tenant_id` in the WHERE clause", regex matches false positives and the script detector requires the rule author to ship a full Python parser.
- **Why it matters:** The rules-vs-noise ratio in substrate audits is the most-visible quality metric. AST-aware rules generate fewer false positives, which builds trust in the audit surface. OP4Z's BE-PY rules in particular would benefit hugely.
- **Approach sketch:** New detector type `tree-sitter`. Rule shape:
  ```yaml
  detector:
    type: tree-sitter
    grammar: python
    query: |
      (call
        function: (identifier) @fn (#eq? @fn "print"))
    paths: ["apps/backend/**/*.py"]
    excludePaths: ["**/tests/**"]
  ```
- Substrate ships `tree-sitter-cli` as an optional dep (probe-based, like ripgrep); fall back to ripgrep when tree-sitter isn't installed. Pre-bundle grammars for Python / TypeScript / JavaScript / YAML.
- **Composability:** Slots into the existing detector dispatch in `src/audit/detectors/`. The composite detector picks it up for free.
- **Effort:** 1-2 weeks. Tree-sitter integration is straightforward; bundling grammars across platforms is the tax.
- **Risk:** Tree-sitter binaries are platform-specific (`@tree-sitter-grammars/*` ships native modules). The substrate-as-clean-npm-install story takes a hit. Mitigate by making tree-sitter strictly opt-in (off by default; users install separately like ripgrep).
- **Priority:** **nice-to-have-v3** (speculative on actual demand; v2's ripgrep + script covers ~85% of useful rules; AST detectors are for the long tail).

### NE-5 — Cross-workflow memory propagation

- **What:** Memories generated by workflow A (via `add-to-memory` applicator) surface in workflow B's context automatically when B's `memory.tags` filter matches. This already works mechanically — but only because the memory file exists and the tags are right. v3 should add explicit provenance: `originatedFrom: workflowId | proposalId`.
- **Why it matters:** When a memory was auto-generated from drift detection in workflow A, it ought to be discoverable as such from workflow B's perspective ("this memory came from a proposal applied two weeks ago"). The audit trail. Today the applicator writes the memory body and that's it.
- **Approach sketch:** Extend the `add-to-memory` applicator to write `metadata.originatedFrom: { proposalId, workflowId, appliedAt }` into the frontmatter. Extend `MemoryEntry` + `LoadedMemory` to expose it. Extend `renderMemoryInjection` to include a provenance line. Update P10 (doctor `memory-frontmatter` check) to recognize the field.
- **Composability:** Touches P5 (memory) + P9 (applicator). No new primitives.
- **Effort:** 2-3 days.
- **Risk:** Low. The provenance is invisible until a tool surfaces it.
- **Priority:** **nice-to-have-v3**.

### NE-6 — Workflow versioning + applicator provenance

- **What:** When the proposal pipeline applies an edit to a workflow YAML, the edit lands as a normal commit-able change. Nothing records "this step was added by proposal `c85b81f4ec8a` on 2026-05-15." If the proposal turned out wrong, finding which proposal introduced the bad step is grep work.
- **Why it matters:** Trust in the auto-apply path is bounded by audit-trail quality. The smoke report showed the applicator works correctly; the question is "how does the user understand what happened later?" Today: comment-preserving YAML edit + the `applied/<date>-<id>.md` archive. The link is by date, not by surgical commit.
- **Approach sketch:** Extend applicator to write a `# substrate-proposal: <id>` comment above each inserted step / appended item, plus a `last_modified_by_proposal: <id>` workflow-level field. The applicator already preserves comments cleanly (smoke test confirmed all 4 comment variants survived); adding one more is mechanical.
- **Composability:** Pure addition to P9 (applicator).
- **Effort:** 1-2 days.
- **Risk:** None observed. Worst case: comments accumulate over time; a `substrate review --proposals --history <workflow>` command could surface them.
- **Priority:** **must-have-v3** — small effort, high audit value, and a natural prereq for any future rollback story.

### NE-7 — Bidirectional proposal authoring: human-initiated drafts

- **What:** Today proposals flow drift → classification → applicator. v3 should let humans (or AI sessions) author proposals directly: `substrate review --propose add-to-rule --rule-id NEW-001 --title "..."` writes a pending proposal that goes through the same walker.
- **Why it matters:** The walker (`substrate review --proposals`) is a polished UX for reviewing typed changes. Building a parallel "manually add a rule" CLI duplicates effort; better to let users dump human-authored proposals into the same queue. Then the walker is the universal "review-and-apply" surface.
- **Approach sketch:** New CLI command `substrate propose <kind> [options]` that constructs a `Proposal` object, marks it `source: human`, writes via `writePendingFile`. Walker doesn't care about source; it walks any pending. Optional `--confidence high` flag for human authors (they vouch for themselves).
- **Composability:** Pure additive on P9. No new primitives.
- **Effort:** 2-3 days per proposal kind; ~1 week for all eight.
- **Risk:** Conceptual: does the walker apply human proposals automatically in `--batch-confirm` mode? Recommend yes when `--source-trust human` is passed — the human-authored ones are by definition reviewed.
- **Priority:** **nice-to-have-v3**.

### NE-8 — Knowledge-source plugin ecosystem (third-party kinds)

- **What:** v2 ships docker-compose / kubernetes / env-registry + a `registerKnowledgePlugin` extension point (`src/v2/knowledge/sources.ts:102`). The contract is functional. The ecosystem question: how does a user *find* third-party plugins?
- **Why it matters:** v3 should surface a public registry — likely a markdown index in the docs site listing community plugins by `kind` name and source. Without discoverability, the extension point is a private one-off.
- **Approach sketch:** Add a `docs-site/src/pages/plugins.astro` page that lists known third-party knowledge plugins (terraform-state, helm-values, aws-sam, vercel-config, …) with install commands and link to source. Maintain the list in `docs-site/data/plugins.json`. A `substrate knowledge --plugins-available` CLI surface that fetches the JSON (or reads from a baked-in copy) and prints the list.
- **Composability:** Documentation primarily; small CLI addition.
- **Effort:** 2-3 days. Most of it is curating the initial list.
- **Risk:** A public list creates a soft endorsement of third-party packages. Mitigate by stating clearly that listings are not endorsements; verify each plugin's basic shape (returns `KnowledgeBlock[]`, no `process.exit`, no network surprise) before listing.
- **Priority:** **defer-to-v4** (no demand yet; manufacture demand first by shipping v2 and seeing if anyone authors a third-party plugin).

### NE-9 — Proposal pipeline: confidence calibration from history

- **What:** The classifier hands out confidence tiers via fixed thresholds (`recurrence >= 3` → high; smoke-fix `c85b81f4ec8a` was low because recurrence was 1). v3 should let confidence be calibrated per-consumer: "in this repo, ad-hoc steps with recurrence ≥ 2 should already be high" or "context-gap proposals should never be high because they're noisy in my codebase."
- **Why it matters:** Consumers will accumulate evidence about which proposals were accepted vs rejected. That evidence should feed back into the classifier so it self-tunes. Today: thresholds are constants in `classifier.ts`. v3: thresholds are functions of accept/reject history.
- **Approach sketch:** Walk `substrate/proposals/applied/` and `substrate/proposals/rejected/`. For each `(kind, drift-kind)` pair, compute acceptance rate. When > 80% historically accepted: bump the new proposal's confidence one tier. When > 80% rejected: drop one tier. Surface in the doctor as a new check: `proposal-classifier-calibration`.
- **Composability:** Reads from the existing queue layout. No new primitives.
- **Effort:** 1 week (including the doctor check + tests).
- **Risk:** Over-tuning: if a consumer rejects 3 in a row by accident, the classifier shouldn't go silent. Cap adjustments at ±1 tier; require ≥10 historical samples before adjusting.
- **Priority:** **speculative** (depends on whether real consumers generate enough proposal traffic for calibration to be meaningful).

### NE-10 — Schedule trigger: `commit-pattern` and `branch-pattern` triggers

- **What:** Today's triggers (`SimpleTrigger`): `manual-command`, `pre-commit`, `pre-push`, `workflow-completion`, `file-change` (unwired), plus `ScheduleTrigger`. Notably missing: "fire when a commit message matches X" (e.g. `feat(.*): .* [OP-\d+]`).
- **Why it matters:** OP4Z's pre-merge audit fires conditionally based on commit-message patterns today, but as a `when` clause inside an already-fired workflow. A first-class `commit-pattern` trigger would let a workflow declare "I run automatically when the user creates a commit matching this pattern" — closing the gap that today requires a separate orchestrator (the `/run` bridge) to dispatch.
- **Approach sketch:** New `CommitPatternTrigger` shape in `types.ts`; producer in a `substrate git-hook install` command that drops a post-commit hook into `.git/hooks/`. Hook reads the last commit message, walks matching workflows, invokes `substrate run` for each.
- **Composability:** Plain addition to P1 + P8.
- **Effort:** 1-2 days.
- **Risk:** Auto-installing git hooks is invasive. Make it opt-in via `substrate git-hook install --pattern commit-pattern`.
- **Priority:** **nice-to-have-v3**.

---

## Ecosystem expansion ideas

### EE-1 — Substrate as a library (programmatic API for other editors)

- **What:** Substrate's `@op4z/substrate` package re-exports a rich deterministic API (`src/v2/deterministic/index.ts` has 100+ exports). Other AI coding tools could embed substrate as a library: Cursor extension imports `discoverWorkflows`, `loadContext`, `walkProposals` and renders them in-editor.
- **Why it matters:** v2.0 ships an MCP bridge (read-only spot-check confirmed in smoke §9). The library path is the next abstraction down: tools that want substrate's primitives without the IPC overhead can import directly.
- **Open questions:** (a) Is the API stable enough to declare semver? (b) Does substrate ship type-safe entry points for non-Node consumers (e.g. a thin Rust binding for IDE integrations)? (c) What's the policy for breaking deterministic-API changes — substrate proper bumps major, downstream consumers re-pin?
- **Approach sketch:** Document the existing programmatic API at `docs-site/src/pages/programmatic-api.astro`. Add a stability matrix (which exports are stable / experimental / internal). Tag internal-only exports with `@internal` JSDoc so TS users see warnings.
- **Effort:** 1 week of documentation + 1 week of stability sweep.
- **Priority:** **speculative** (don't invest in stability guarantees before consumers exist).

### EE-2 — Public workflow registry (parallel to rules-registry)

- **What:** v1 shipped a rules-registry pattern (workflows under `templates/standards/cross-cutting/RULES.yaml` are curated reference content). Workflows could have the same: a community registry of "useful workflows for service X / framework Y." Cursor / Continue ship snippet libraries; substrate could ship a workflow library.
- **Why it matters:** First-time consumers benefit hugely from a "browse community workflows for FastAPI / Next.js / Rails" surface. Reference templates are the visible API; expanding them is the lowest-friction adoption boost.
- **Approach sketch:** GitHub repo `op4z/substrate-workflows-registry`. Categorize by language / framework. Substrate ships `substrate workflow install <registry-id>` that fetches + scaffolds. Same shape as v0.5's existing `substrate add <scaffold-id>` pattern.
- **Composability:** Reuses `substrate add` discovery.
- **Effort:** 1 week for the install command + the initial 10 reference workflows.
- **Priority:** **nice-to-have-v3** (real consumer adoption signal first).

### EE-3 — Additional task adapters

- **What:** v2 ships Linear / Jira / GitHub adapters (+ stub). Adjacent ecosystems: Asana, Trello, Notion-as-tasks, ClickUp, Monday. Each adapter is small (~150 lines of structural-typed wrapper around the upstream SDK).
- **Why it matters:** OP4Z has its own task system (the inventory references `./exc api --create-task`). External consumers will have their own; each missing adapter is a friction point. The Linear adapter is the reference shape (`packages/adapter-linear/src/index.ts`).
- **Approach sketch:** Each new adapter is a new `packages/adapter-<name>/` package. Same structure as `adapter-linear`. Ship as separate npm packages so consumers install only what they need.
- **Effort:** 2-3 days per adapter.
- **Priority:** **defer-to-v4** (do this only when consumer demand named a specific adapter).

### EE-4 — Standards docs as a syndicated library

- **What:** Today substrate's `templates/standards/` ships ~3 docs + the RULES.yaml. OP4Z has 25 standards docs. v3 could let substrate consume an external standards library: "load `@op4z/python-standards@1` as substrate/standards/python/" and substrate's `context.standards: python/architecture.md` resolves transparently.
- **Why it matters:** The "engine ships the contract; users bring the content" principle (plan §2.5) is sound — but in practice, standards docs are mostly generic and re-authored per-consumer. A syndicated library would let small teams adopt a baseline without writing 25 docs.
- **Approach sketch:** `substrate.config.json` gains `standards.sources: [{ kind: npm, package: "@op4z/python-standards", version: "1.x" }]`. Resolver fetches + writes to `substrate/standards/.imported/python/`. Context loader treats imported paths transparently.
- **Composability:** Touches P5 (memory frontmatter for imported standards), context-loader. Reuses npm as the distribution channel.
- **Effort:** 1-2 weeks.
- **Risk:** Imported standards must be versioned; consumer needs to know when an upgrade changes rule behaviour. Same problem npm has, same solutions (lockfile).
- **Priority:** **defer-to-v4** (consumer demand signal needed; the inventory implied no demand yet).

---

## Performance / scale concerns

### PS-1 — Drift detection's cross-session scan

- **What:** `runDriftDetectors` (`src/v2/orchestrator/drift-detectors.ts:390-478`) reads up to `historyLimit` (default 10) prior session-event-logs for the same workflow id. On every workflow completion. The session-log dir grows monotonically — `substrate/sessions/<workflow-id>-<sha>.jsonl` per run.
- **At scale:** With 100+ sessions per workflow, the limit-10 default is fine. With 1000+ sessions per workflow (a busy team running `pre-merge-gate` on every PR), the `indexSessionLogs` walk reads every file's stat + filename — but only loads 10. Performance should hold.
- **Concern:** If `historyLimit` grows or detectors widen, the cost scales with session count. Already worth instrumenting now.
- **Suggested action:** Add a `substrate sessions --rotate --keep N` command that archives sessions older than N. Combine with a doctor check `session-log-bloat` that warns when sessions dir > 1000 entries. Effort: 1-2 days.
- **Priority:** **nice-to-have-v3** (preemptive; no observed problem yet).

### PS-2 — Context loading at workflow start

- **What:** `loadContext` (`src/v2/context-loader.ts:106-132`) reads every declared standards doc, queries memory, loads RULES, and resolves knowledge. For a workflow like `tackle-task` that declares `context.rules: ["*"]` and 6 standards docs, this can mean ~100 file reads.
- **At scale:** On a small repo (substrate's own), <100ms. On a 100k-LOC repo with 200+ rules and 50 standards docs, multi-hundred ms before the first step runs. For interactive AI sessions, that's noticeable.
- **Concern:** No caching. Every `substrate run` invocation re-walks. `memoryInjection` re-renders.
- **Suggested action:** Add a `substrate cache --warm` command that pre-computes `loadContext` output for every workflow and writes to `substrate/.cache/context-<workflow>-<hash>.json`. Run-command checks the cache by manifest hash; falls back to live load on mismatch. Effort: 3-5 days. Risk: cache staleness; the manifest-hash invalidation is the right key but memory + standards files change independently — need a multi-hash invalidation strategy.
- **Priority:** **speculative** (premature optimization without observed slowness).

### PS-3 — Audit against large repos

- **What:** The ripgrep detector uses `spawnSync` with stdio: "inherit" (no — actually returns parsed output). On a 100k-LOC repo with 50 rules, that's 50 ripgrep invocations. Each ~100-300ms with ripgrep's gitignore-respecting walk. Total: 5-15s for a full audit.
- **At scale:** Acceptable for periodic audits; high for pre-merge gates where the user is waiting on the result.
- **Concern:** Rules execute sequentially. Parallelism would help.
- **Suggested action:** `runAuditAll` could fire ripgrep detectors in parallel (with a concurrency cap — say 4). Audit detector framework would need to handle this via a worker pool. Effort: 1 week. Risk: rate-limiting hits if many rules share a `paths:` glob — ripgrep traverses the same tree N times.
- **Priority:** **nice-to-have-v3**.

### PS-4 — Proposal queue growth

- **What:** `substrate/proposals/pending/` accumulates files. Each is small (~2KB), but the smoke spot-check didn't exercise the "stale-proposals" doctor check, which was deferred. If proposals stack up, the walker walks more than the user wants to see.
- **Suggested action:** Doctor's `stale-proposals` check (already shipped, but minimally tested) should fire at 90 days by default. Walker should default to showing high-confidence first, low-confidence collapsed. A `substrate review --proposals --since 7d` flag scopes the walk. Effort: 2-3 days.
- **Priority:** **nice-to-have-v3**.

---

## Surface polish & UX (not novel but cumulatively meaningful)

### UX-1 — `substrate doctor --fix` for autofixable warnings

A handful of doctor checks have obvious autofixes (e.g. memory-frontmatter missing the `type:` field → infer from filename prefix; stale-proposals → defer or reject in bulk). A `--fix` flag that walks fixable checks would tighten the doctor → action loop. Effort: 1 week. Composability: extends P10.

### UX-2 — `substrate init --v2-only` flag

Smoke-fix Finding 3 made init scaffold both `auto/` (v1) and `substrate/` (v2). A `--v2-only` flag for fresh consumers who don't want the v1 layout would clean up the new-repo case. Effort: 1 day.

### UX-3 — `substrate review --proposals --by-confidence high`

The walker today walks every pending in date order. A `--by-confidence` flag would let users batch the high-confidence ones first. Effort: 1 day. Already mostly there — `WalkProposalsOptions` has `decisions` (programmatic seed); needs a CLI mirror.

### UX-4 — Interactive proposal walker (deferred-by-design but worth revisiting)

Plan §13 scopes out the visual / web UI. But the CLI walker today uses `@inquirer/prompts` (verified in `src/v2/deterministic/proposals/review-command.ts` import surface). A richer terminal UI (ink / blessed) for visualizing proposals with diff previews would be ~1 week and stay within "CLI walk is the contract" — just a more polished CLI walk. Worth the investment if proposal volume justifies it post-v2.

### UX-5 — JSON output for `substrate explain` (NEW from TI-3)

When `substrate explain --json`, output the loaded context + rendered prompt as a structured object so CI / agent integrations can consume. Should be a baseline expectation for any new v3 command.

### UX-6 — `substrate workflow describe --v2` (smoke-fix obs #2)

The smoke-fix observation explicitly called this out. Today the legacy describe surface compresses v2 step types into v1 `[prompt|command|audit]` pills. A `--v2` flag (or a separate `substrate workflow describe-v2 <id>` command) would render the manifest faithfully: each step's full type, its prompt/run body, its must-confirm flag, etc. Effort: 1-2 days.

---

## Things v2 explicitly punted on that should stay punted

- **Beau-hosted services / SaaS** (plan §13). v2 stays local-log-only and that's the right call. The proposal pipeline's value is consumer-private knowledge accumulation; centralizing it would invert the trust model.
- **Substrate-native memory backend** (plan §13). v2 reads Claude Code's existing format and that's strictly correct. Writing a custom backend would fragment the memory ecosystem; let Claude Code (and Cursor, Continue, etc.) own that surface, substrate reads from theirs.
- **Visual / web UI for proposal review** (plan §13). The CLI walker is good enough at the scale v2 ships at. A web UI would force a stateful host process or a database; both invert v2's "local files are the source of truth" model.
- **Multi-repo orchestration** (plan §13). One repo at a time is the right scope. Multi-repo introduces tenancy, secret-sharing, and concurrency problems substrate isn't suited to.
- **Custom proposal types beyond 8** (plan §13). The 8 types cover the proposal-classification space comprehensively. Adding more would dilute the dispatch table without adding value; if a 9th kind genuinely emerges, it should compose existing kinds first.
- **AI-drafted applicator polish** (v2.0 → v2.x roadmap item from HANDOFF). The deterministic drafts work. Wrapping in an AI polish step is a temptation that crosses the "deterministic primitives below, AI above" line — the applicator should stay deterministic; an orchestration-layer post-applicator AI step is the right shape *if* it emerges, but v2.x can defer.

---

## Things you did NOT explore

- **Action.yml integration deeply.** Spot-checked it was structurally correct (smoke §8). Didn't trace what changes when v2 features get wrapped in GitHub Action shape. The action is version-agnostic per the smoke report, so this should mostly carry forward.
- **The `substrate query sessions` CLI in depth.** Listed as a B4 surface; smoke §3 confirmed it works on a fresh fixture. Didn't probe what queries are useful at 1000+ sessions scale (relevant to PS-1).
- **Adapter contracts beyond Linear.** Confirmed structural shape; didn't read GitHub or Jira adapters in detail. Their shape mirrors Linear's.
- **The audit composite detector's behaviour at depth.** Skimmed `composite.ts` existence; didn't trace how findings get merged when 5+ rules apply to the same file.
- **Telemetry surface.** v1 telemetry persists at `v: 2`; spot-checked in smoke §7 that the surface is unchanged. v3 might want a session-event-log → telemetry bridge for opt-in analytics, but that crosses the "local-log-only" rule from plan §13 and so wasn't pursued.
- **Schema-evolution story.** `schema_version: v2.0` is the only declared version. v3 will need a migration playbook; the `templates-history/` snapshots imply Beau already anticipates this. Didn't audit whether the manifest is forward-compatible (extra fields preserved through edits) — relevant to NE-6 (applicator provenance).
- **Cross-platform: Windows path semantics.** Linux-only; not assessed.
- **Plan §12 open questions (7 of them).** Some may have been resolved during v2 implementation; didn't trace each to a HANDOFF answer.

---

## Honest framing for Beau

The single most-important takeaway: **v2 is genuinely well-saturated for what it set out to do.** The headline differentiator (proposal pipeline) works end-to-end and the smoke + smoke-fix passes left it ship-ready. Most "improvements" I found below are either (a) finishing-touches that fit v2.1, (b) speculative net-new directions that need real-user signal to design well, or (c) deferred-by-design items that the plan was right to defer.

**The one item that's not "polish" or "speculative" is the AI-step engine (TI-1).** The orchestrator returning `deferred` for six step types is the single largest hidden-cost item in v2.0. It doesn't block the v2.0 publish — but the proposal pipeline's quality measurements (drift detection accuracy, classification calibration) will all be artificially low until real AI steps generate real `prompt-issued` / `step-confirm` events. That's the v2.1 priority IMO, regardless of what gets numbered v3.

For v3 proper, **NE-1 (reverse proposal pipeline) is the closest analogue to v2's headline.** v2 found drift in declared workflows; v3 should find latent workflows in undeclared sessions. Same engine, opposite arrow. Everything else in this report is either supporting that direction or independent quality-of-life work.

---

*End of v3 exploration. Filed for the next agent or for Beau's reading; no code changed, no commits.*
