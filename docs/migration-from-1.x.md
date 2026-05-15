# Migration from substrate v1.x to v2.0

> **TL;DR.** There are no breaking changes from 1.x to 2.0. v2.0 is
> fully additive. Existing v1.x consumers can upgrade without any
> code or config changes; the new surface is opt-in.

This guide documents what's new in v2.0 and how to adopt each new
primitive in your repo. Read the [CHANGELOG.md](../CHANGELOG.md) for
the full changelog and the [docs-site](https://op4z.github.io/substrate/)
for narrative documentation.

---

## What stays the same

Every v1.0 surface continues to work in v2.0 with identical behaviour:

- `substrate init` — same scaffold (substrate.config.json, auto/, optional bridges)
- `substrate audit` — same RULES.yaml detector runtime (ripgrep / script / composite)
- `substrate add` — same per-item scaffolds (audit / standard / scaffold / command / workflow)
- `substrate create` — same package + service templates
- `substrate doctor` — same v1 baseline checks (tooling / config / manifest / stacks / bridges); v2 adds opt-in `--check <name>` slices
- `substrate knowledge refresh` — same default behaviour when no `substrate/knowledge-sources.yaml` is present
- `substrate task` — same adapter-driven verbs (find / search / create / update / complete)
- `substrate workflow` — same v1 `auto/config/workflows.yaml` multi-step runtime (distinct from v2's `substrate run`)
- `substrate upgrade` — same three-way merge against `templates-history/`
- `substrate mcp serve` — same MCP server (stdio transport)
- `substrate telemetry` — same opt-in, same local JSONL log
- `substrate config --telemetry` — same toggle
- `substrate uninstall` — same removal flow

Test files, CI matrix, schemas, the standards bundle (21 docs), the
RULES.yaml skeleton (35 rules) — all unchanged in shape and behaviour.

The telemetry contract stays at `v: 2`. v2.0 adds a separate
session-event-log channel under `substrate/sessions/` for workflow
runs; it carries no `version` field — events are self-describing via
their `event` discriminant.

---

## What's new (opt-in)

### Workflow runtime (`substrate run`)

Author a v2 workflow manifest at `substrate/workflows/<id>.yaml` plus
a prose body at `substrate/workflows/<id>.body.md`. Then:

```bash
substrate validate substrate/workflows/<id>.yaml   # check the schema
substrate run <id> --dry-run                       # plan steps
substrate run <id>                                 # execute
```

Reference templates ship at `templates/workflows/` in the package
(`tackle-task`, `audit-service`, `audit-package`,
`weekly-proposal-walk`). Copy one out as a starting point.

The v1 `substrate workflow list / describe / start` surface (driven
by `auto/config/workflows.yaml`) is unchanged. The two systems coexist
— `substrate workflow` reads the v1 registry, `substrate run` reads
the v2 manifests. Migrate at your own pace.

### Cross-cutting hooks

Drop a YAML manifest under `substrate/hooks/<id>.yaml` declaring a
trigger + a step. Hooks fire on every matching workflow run without
per-workflow opt-in. Four built-ins ship as templates:

- `auto-emit-sidecar` — JSON sidecar after audit runs
- `auto-update-trend` — append to `_trend.jsonl`
- `auto-propose-tasks` — draft task entries from findings
- `auto-drift-detect` — the proposal pipeline integration point

Inspect:

```bash
substrate hooks list
substrate hooks describe auto-drift-detect
```

### Conditional doc-checks

Drop a YAML manifest under `substrate/doc-checks/<id>.yaml`:

```yaml
id: changelog-on-feat
match:
  commit-message-pattern: "^feat"
require:
  changed-files-any: ["CHANGELOG.md"]
```

Evaluate from CI / pre-commit:

```bash
substrate query doc-checks --for-files "src/foo.ts" --commit-message "feat: add foo"
```

### First-class memory

Substrate reads Claude Code's per-project memory directory by default.
Precedence (highest first):

1. `--memory-path <dir>`
2. `SUBSTRATE_MEMORY_PATH` env var
3. `substrate.config.json#memory.path`
4. Claude Code's per-project directory

Query:

```bash
substrate query memory --types feedback,project --tags ai-workflow
```

Workflow manifests inject memory into their AI context via
`context.memory`:

```yaml
context:
  memory:
    types: [feedback, project]
    tags: [ai-workflow]
    intersect-with-changed-files: true
```

### Proposal pipeline (the headline)

After running `substrate run <workflow>`, drift detectors observe the
session-event log and propose changes back to the workflow / rules /
standards / memory. Walk the queue:

```bash
substrate review --proposals             # interactive
substrate review --proposals --dry-run   # preview
substrate review --proposals --batch-confirm  # auto-accept high tier
```

Eight proposal kinds, six drift detectors, deterministic applicators
(comment-preserving YAML edits, RULES.yaml appends, memory writes,
ADR drafts). See `docs/migration-from-1.x.md#adoption-roadmap` below
and the [proposals doc-site page](https://op4z.github.io/substrate/proposals/)
for the full walkthrough.

### `trigger: schedule`

Workflows can declare cron / interval / every-n-commits schedules:

```yaml
trigger:
  - schedule: { cron: "0 9 * * 1" }
```

Substrate ships only the discovery + state-tracking primitives.
Invocation is your consumer's choice — three patterns (CI / local
cron / AI session) are documented in `docs/scheduling.md`. The
scheduler is non-invasive:

```bash
substrate scheduler --check --due-only
```

### `composes_findings_of` + `escalate_after`

Two primitives for cross-workflow + cross-run awareness:

- `composes_findings_of` (workflow-level) — pull findings from
  upstream workflows into a downstream one's context.
- `escalate_after` (RULES.yaml-level) — bump finding severity once
  age exceeds a declared threshold. The doctor check
  `--check escalation-debt` surfaces findings stuck at critical for
  too long.

### Plural knowledge sources

Drop `substrate/knowledge-sources.yaml` to declare typed source
entries:

```yaml
sources:
  - kind: docker-compose
    path: ./docker-compose.yml
  - kind: kubernetes
    paths: ["k8s/**/*.yaml"]
  - kind: env-registry
    paths: [".env.production.template"]
```

Three built-in plugins; custom plugins ship via
`registerKnowledgePlugin()`. Full contract:
[`docs/knowledge-sources.md`](./knowledge-sources.md).

When the manifest is absent, `substrate knowledge refresh` falls
through to v1's `substrate.config.json#knowledge.sources` flat-string
list — no migration needed for existing consumers.

### Doctor v2 checks

Five new `--check <name>` slices, runnable individually or aggregated:

```bash
substrate doctor --check rules-doc-coverage
substrate doctor --check workflow-coverage
substrate doctor --check memory-frontmatter
substrate doctor --check stale-proposals
substrate doctor --check escalation-debt
substrate doctor                       # all v1 baseline + all v2 checks
```

`--stale-proposals-days 60` and `--escalation-debt-days 14` override
the defaults (90 and 30 respectively).

---

## Adoption roadmap

Start with the v2 surface that maps to your immediate pain points.
The primitives are independent — adopt in any order.

| Pain                                       | Adopt                                                         |
| ------------------------------------------ | ------------------------------------------------------------- |
| "Our audits don't tell us when something's been broken for a month." | `escalate_after` + `substrate doctor --check escalation-debt` |
| "Our workflows accumulate undocumented ad-hoc steps." | `substrate run` + the proposal pipeline                       |
| "Standards docs and RULES.yaml drift apart." | `substrate doctor --check rules-doc-coverage`                 |
| "We have k8s manifests but `substrate knowledge` ignores them." | `substrate/knowledge-sources.yaml` + the `kubernetes` plugin  |
| "Our pre-commit gate doesn't know to require CHANGELOG.md on feat: commits." | Conditional doc-checks (P4)                                   |
| "We're running weekly grooming manually."  | `trigger: schedule` + `weekly-proposal-walk`                  |
| "AI assistants forget context across runs." | First-class memory (P5) + the bridges                          |
| "Our PR review repeats the same audits."   | `composes_findings_of` (P6)                                   |

---

## Step-by-step (worked example)

If you have a v1.x substrate-using repo and want to migrate to a
fully v2 workflow surface, here's the recommended order:

1. **Upgrade the package.**

   ```bash
   npm install -D @op4z/substrate@2.0
   substrate doctor                   # confirm v1 surface still green
   ```

2. **Create your first workflow manifest.**

   ```bash
   cp -r node_modules/@op4z/substrate/templates/workflows/tackle-task* \
     substrate/workflows/
   substrate validate substrate/workflows/tackle-task.yaml
   ```

   Edit the manifest + body to match your team's actual task flow.

3. **Add cross-cutting hooks.** Copy the built-in hooks templates
   into `substrate/hooks/` (or write your own). Start with
   `auto-drift-detect` if you want the proposal pipeline to fire.

4. **Wire conditional doc-checks.** Capture the 2-3 "if you change X,
   you must also touch Y" rules your reviews already enforce into
   `substrate/doc-checks/` manifests.

5. **Add memory frontmatter.** If your repo has a `MEMORY.md`
   directory (Claude Code default), tag each memory's frontmatter
   with `type` / `scope` / `tags`. `substrate doctor --check
   memory-frontmatter` will tell you which memories are still bare.

6. **Migrate knowledge sources.** Author
   `substrate/knowledge-sources.yaml` for any k8s manifests / env
   registries you want surfaced in `KNOWLEDGE.md`. The v1 fallback
   keeps working until you delete the `knowledge.sources` block
   from `substrate.config.json`.

7. **Declare escalation curves.** Add `escalate_after:` entries to
   the RULES.yaml rules where age-based severity makes sense
   (CVE-flavoured rules, tech-debt rules, security rules).

8. **Schedule the proposal walk.** Drop
   `templates/workflows/weekly-proposal-walk.*` into
   `substrate/workflows/` so the proposal queue gets reviewed
   weekly. Wire the schedule trigger to your CI / local cron / AI
   session.

After step 8, you're running the full v2 surface. You can keep using
v1's `substrate audit` + `substrate workflow start` indefinitely —
the two systems coexist by design.

---

## Programmatic API additions

If you import substrate as a library:

```ts
import {
  // v1.0 surface (unchanged)
  runInit,
  runAuditExecute,
  loadRules,
  // v2.0 deterministic surface
  discoverWorkflows,
  loadContext,
  runValidate,
  runQueryRules,
  runQuerySessions,        // new in B4
  discoverHooks,
  discoverDocChecks,
  queryMemory,
  runProposalPipeline,
  walkProposals,
  applyProposal,
  checkSchedule,
  discoverKnowledge,       // new in B4
  registerKnowledgePlugin, // new in B4
  // v2.0 orchestration surface
  runV2Workflow,
  emitSessionEvent,
} from "@op4z/substrate";
```

Type exports for every public interface ship alongside.

---

## FAQ

**Q: Will my v1.x scaffolded files survive `substrate upgrade`?**
A: Yes. The three-way merge model is unchanged; v2 templates are
new files (under `substrate/workflows/`, `substrate/hooks/`, etc.)
that don't conflict with v1's `auto/` layout.

**Q: Do I have to use AI to use v2?**
A: No. The deterministic layer (validators, query commands,
proposal queue I/O, applicators, scheduler) requires no AI session.
You can adopt hooks + doc-checks + escalation + knowledge sources
without ever running `substrate run`.

**Q: Will my CI break?**
A: No. v2.0 ships no breaking changes. Your existing
`substrate audit` / `substrate doctor` / `substrate workflow` calls
keep working.

**Q: Where do session-event logs live?**
A: `substrate/sessions/<workflow>-<sha>.jsonl`. Sanitised against
a hardcoded blocklist (no paths, tokens, emails); intended to be
checked into your repo. Cap field sizes at 120 chars for
`description` / `prompt` / `output`.

**Q: Do I need to update Node?**
A: No. `engines.node` stays at `>=20.0.0` in v2.0. CI matrix
covers Node 20 + 22 + 24.

**Q: Will substrate publish data anywhere?**
A: No. Telemetry stays opt-in, local-only by default. The
`--telemetry-endpoint` flag forwards to a user-configured collector
only when explicitly enabled.
