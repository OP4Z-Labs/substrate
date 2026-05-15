# Substrate v2 — Phase B4 (Polish + release) Handoff

> **Status:** B4 complete. Substrate v2.0 is GA-ready locally.
> **Branch:** `v2` (15 commits ahead of `main`)
> **Test count:** 608 passed + 1 skipped (started B4 at 573 + 1; +35
> new tests across 3 new test files)
> **Gates:** build, lint, typecheck, test, docs-site build — all
> green at v2.0.0.
> **Next agent run:** none required. Beau publishes manually when
> the op4z org access lands.

B4 is purely additive on top of B1 + B2 + B3. v1.0 surface remains
untouched (only the version constant changed from 1.0.0 → 2.0.0).
Five sub-phase commits, partitioned at clean shippable boundaries.

---

## Completed in this run

### Commits

| SHA       | Message                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| `7cb99fc` | feat(v2): doctor v2 checks + query sessions CLI [substrate-v2-B4]                         |
| `f6cade3` | feat(v2): plural knowledge sources — kubernetes + env-registry [substrate-v2-B4]          |
| `59d36b5` | docs(v2): docs-site v2.0 — workflows + proposals + knowledge pages [substrate-v2-B4]      |
| `4ded5c6` | docs(v2): CHANGELOG + migration + release-2.0 checklist [substrate-v2-B4]                 |
| `bfb9d73` | release(v2): bump to 2.0.0 + templates-history snapshot [substrate-v2-B4]                 |

Five commits aligned with the natural sub-phase decomposition the
brief outlined. The version bump (last commit) is the contract that
"v2.0 is feature-complete and gate-green" — every preceding sub-phase
left tests green at 1.0.0 so the bump was the small final action.

### Sub-phase 1 — Doctor v2 checks + `query sessions` CLI

Primitive 10 was partially shipped in B3 (memory-frontmatter
aggregation only). B4 finishes the set:

- `--check rules-doc-coverage`: RULES.yaml rules without a `doc:`
  reference (OP4Z Gap 8 closure). Severity warn; lists up to 5 rule
  ids.
- `--check workflow-coverage`: workflows missing a paired
  `.body.md` (warn) or with invalid manifests (error).
- `--check stale-proposals`: pending proposal files older than
  `--stale-proposals-days` (default 90 per plan §3.10). Reads the
  filename date — robust to filesystem moves.
- `--check escalation-debt`: walks `substrate/audits/*-latest.json`
  sidecars for findings stuck at critical for ≥
  `--escalation-debt-days` (default 30).

Each addressable individually via `substrate doctor --check
<name>`; the unscoped run includes baseline + all v2 checks
(memory-frontmatter from B3 + B4's four). Scoped mode suppresses
the v1 baseline (tooling / config / manifest / stacks / bridges)
so the output matches the requested slice.

The deferred `substrate query sessions` wrapper from B3 ships as a
~80-LOC addition to `query-command.ts` plus the CLI surface. Wraps
`indexSessionLogs` + `readSessionLog` with newest-first sorting,
`--workflow` filtering, `--limit`, and `--include-events` to embed
parsed events inline. `--json` works.

Tests +22 (12 doctor + 10 query-sessions). All paths covered:
positive / negative / scoped / aggregate.

### Sub-phase 2 — Plural knowledge sources (Primitive 11)

New module `src/v2/knowledge/sources.ts` (~580 LOC) ships:

- Plugin contract: `(absolutePath, repoRoot, options?) =>
  KnowledgeBlock[]`. Pure function, no AI, no network.
- Three built-in plugins:
  - `docker-compose` — port + service + depends + volumes
    (verbatim from v1's parser; relocated)
  - `kubernetes` — multi-doc YAML; Service / Deployment /
    StatefulSet / DaemonSet → service blocks (ports + container
    images); Secret / ConfigMap → secrets blocks (KEYS ONLY,
    values never read)
  - `env-registry` — one block per env-var key, values always
    redacted
- `registerKnowledgePlugin(kind, fn)` for third-party plugins;
  naming convention `<org>:<name>` recommended in the docs.
- Minimal glob expander (`**` recursion + `*` per-segment), skips
  `node_modules` and dotfile-prefixed directories. Sufficient for
  the `k8s/**/*.yaml` + `.env.production.template` shapes.

`substrate knowledge refresh` is the consumer-facing change: if
`substrate/knowledge-sources.yaml` exists, v2 plugins drive the
render; otherwise the v1 fallback (substrate.config.json#knowledge.sources)
runs unchanged. The renderer adds a "Kubernetes resources" table
and a "Secret + ConfigMap keys" section to KNOWLEDGE.md, plus a
"Discovery summary" footer with per-kind block counts. Manifest
warnings render at the top.

Custom plugin contract documented in `docs/knowledge-sources.md`
(naming conventions, block-category table, determinism contract,
programmatic API, v1 → v2 migration steps).

Tests +13 (manifest parse + 3 built-ins + glob recursion + custom
plugin registration + v1/v2 fallback paths).

### Sub-phase 3 — Docs site v2.0 update

Three new pages (`docs-site/src/pages/`):

- `proposals.astro` — THE HEADLINE. Pipeline architecture
  (telemetry → drift detectors → classifier → queue → walker →
  applicators), worked example from plan §7, eight proposal
  kinds, six drift detectors, confidence model, batch-confirm
  semantics, telemetry boundary.
- `workflows.astro` — P1 through P8 covered end-to-end. Worked
  examples for hooks, doc-checks, memory, composition,
  escalation, scheduling. Reference workflows listed.
- `knowledge-sources.astro` — P11 quick reference. Built-in
  plugin table, glob support, custom plugin example, secret
  protection callout, v1 fallback note.

Three existing pages refreshed:

- `index.astro` — v2.0 headline + features at top; v1.0 features
  under "Built on the v1.0 foundation" section.
- `commands.astro` — split into v1.0 (audit + scaffolding) +
  v2.0 (workflow runtime + proposal pipeline) command tables.
  Layer-discipline callout.
- `quick-start.astro` — v2 surface (validate / run / query
  sessions) added; v1 audit flow preserved.

`Base.astro` nav: added Workflows / Proposals / Knowledge
sources entries. CSS additions for blockquote + table styling
(the longer-form prose pages need them).

Gotcha encountered + fixed: Astro parses `{ ... }` inside JSX
content as expressions. YAML inline maps in code blocks
(`schedule: { cron: "0 9 * * 1" }`) had to be entity-encoded
(`&#123;` / `&#125;`) so the build wouldn't fail. The rendered
HTML is correct.

Docs site builds clean: 10 pages in 762ms.

### Sub-phase 4 — CHANGELOG + migration + release-checklist

Three release-blocking docs:

- `CHANGELOG.md` gains the `[2.0.0]` section above `[1.0.0]`.
  Keep-a-Changelog format. Documents every primitive by phase
  (B1 / B2 / B3 / B4), the additive nature of the release, and
  the session-event-log being a separate channel from telemetry
  v: 2.
- `docs/migration-from-1.x.md` — full migration guide. Headline
  finding: there are NO breaking changes from 1.x to 2.0. v2.0
  is fully additive. Covers what stays the same (every v1.0
  surface preserved verbatim), what's new (each primitive with
  an adoption snippet), an 8-step worked example for greenfield
  v2 adoption, programmatic API additions, and an FAQ.
- `docs/release-2.0-checklist.md` — publish playbook. Mirrors
  the v1.0 checklist structure. Explicit non-actions: don't
  run `npm publish`; op4z org access recovery is the gating
  prereq.

### Sub-phase 5 — Version bump 2.0.0 + npm pack verification

The LAST commit of v2.0.

Version bumps:

- `packages/substrate/src/util/version.ts`: `SUBSTRATE_VERSION`
  1.0.0 → 2.0.0
- `packages/substrate/package.json`: 1.0.0 → 2.0.0
- Root `package.json` (substrate-monorepo): 1.0.0 → 2.0.0
- `docs/telemetry-transparency.md` + `src/util/telemetry.ts`:
  example "e.g. 1.0.0" → "e.g. 2.0.0" (informative only;
  schema version stays at `v: 2`)

Adapter packages stayed at 0.8.0 — their public surface didn't
change in v2.0 and they aren't required by the `@op4z/substrate`
publish.

Templates-history snapshot: `cp -r packages/substrate/templates
packages/substrate/templates-history/2.0.0`. Now v0.5.0 / 1.0.0 /
2.0.0 anchors exist for three-way merge during future minor
versions.

README.md + LICENSE copied into `packages/substrate/` so the npm
tarball's `files` array picks them up. The originals at the repo
root stay as the source-of-truth.

`npm pack` verification:

- Tarball: `/tmp/op4z-substrate-2.0.0.tgz`, 432 KB, 568 files
- Contains: dist/ (cli + all compiled .js + .d.ts), templates/,
  templates-history/{0.5.0,1.0.0,2.0.0}/, schemas/* (four
  schemas), README.md, LICENSE, package.json
- Excludes: source .ts files, .agent/ HANDOFFs, tests/, docs/,
  node_modules/, vitest.config.ts, tsconfig*.json at package
  level
- Installed in a clean tempdir:
  `npm install op4z-substrate-2.0.0.tgz` succeeds;
  `substrate --version` reports `2.0.0`; `substrate --help`
  lists every v2 command (validate / query [rules,standards,memory,
  doc-checks,sessions] / hooks [list,describe] / run / scheduler /
  review); `substrate doctor --help` exposes the four new `--check`
  variants.

Did NOT run `npm publish`. Did NOT push to GitHub. Both are
maintainer actions per the brief's hard rules.

---

## Pending / next up

### What v2.0 ships missing (acknowledged, deferred)

None of the following block the v2.0 publish — all were called out as
deferrable in the brief or in the phased plan:

- **AI-drafted standards-doc + ADR applicators.** B3 ships
  deterministic drafts with embedded `<!-- substrate-proposal:
  <id> -->` anchors. A future minor version could wrap them in an
  orchestrator-layer AI polish step. Not blocking.
- **Visual / web UI for proposal review.** Plan §13 explicitly
  scopes this out of v2.0. CLI walk is the contract.
- **`substrate scheduler --auto-run`.** Today's CLI is
  non-invasive. A future enhancement could let cron-driven
  invocations call `substrate run` directly. Trivial wrapper when
  the use case demands it.
- **Public extension point for the noop-handler registry.** B2's
  open question; B3/B4 stayed internal. Recommend leaving until a
  real plugin contract emerges from consumer demand.

### Publish prerequisites (maintainer-side)

Before `npm publish --access public`:

1. op4z org access recovery (Beau's open support ticket)
2. npm authentication token with publish rights on `@op4z/`
3. GitHub repo write access for the `v2.0.0` + `v2` tags

The release-2.0-checklist.md documents each step. **Substrate
itself is GA-ready** — every gate is green at v2.0.0, the tarball
is correct, the CLI runs.

---

## Open questions for the user

None blocking. Two observations worth flagging:

- **README.md duplication.** v2.0 commits a copy of README.md +
  LICENSE into `packages/substrate/` (vs the repo-root originals)
  so the npm tarball's `files: ["README.md", "LICENSE"]` picks
  them up. This mirrors the v1.0 setup (which also relied on
  similar duplication or symlinks). A pre-publish hook could
  sync them automatically — defer until the maintainer wants
  the polish.

- **Adapter package versions.** All four adapters
  (adapter-stub / adapter-linear / adapter-jira / adapter-github)
  stay at 0.8.0. They weren't touched in v2.0 and aren't part of
  the `@op4z/substrate` publish. If Beau decides to publish them
  alongside, the release-2.0-checklist.md notes the per-adapter
  publish step.

---

## Notes for the next agent

There is no next agent run required. v2.0 is GA-ready locally.

If a future v2.1 / v2.x agent is invoked:

### Conventions established in B4

1. **`--check <name>` is the doctor v2 surface.** New checks add
   to the `V2_CHECKS` registry in `src/commands/doctor.ts`. Each
   is a small named function returning `Check[]`. The aggregate
   run picks them up automatically; the scoped run filters by
   name. Unknown names produce a warn entry, not a crash.

2. **Knowledge source plugins are pure.** `(absolutePath,
   repoRoot, options?) => KnowledgeBlock[]`. No AI, no network,
   no spawning. Custom plugin namespacing is `<org>:<name>` so
   third-party additions don't collide with built-ins.

3. **`KnowledgeBlock.category`** in `services` | `env-vars` |
   `secrets` | `custom`. The built-in renderer surfaces the
   first three; `custom` is reserved for downstream consumers of
   `discoverKnowledge()` (e.g. an MCP tool).

4. **Docs-site code blocks containing `{ ... }` must
   HTML-entity-encode the braces.** Astro parses `{ }` as JSX
   expressions even inside `<pre><code>`. Use `&#123;` / `&#125;`
   for YAML inline maps.

5. **Per-version templates-history/ snapshots are mandatory for
   minor + major bumps.** Pattern: `cp -r templates/
   templates-history/<version>/` then commit. Without the snapshot
   the three-way merge upgrade flow can't resolve.

6. **Version bump is the LAST commit of every release phase.**
   It signals "feature-complete + gate-green" — by convention,
   nothing else is queued behind it.

### Gotchas

1. **`{ ... }` inside `<pre><code>` in Astro pages.** See #4 above.
   Cost me one build failure during sub-phase 3.

2. **README.md/LICENSE source-of-truth duality.** The repo-root
   originals are canonical; the `packages/substrate/` copies exist
   only so the npm `files` array can find them. If you edit one,
   keep both in sync.

3. **`runDoctor`'s `--check` flag suppresses the v1 baseline.**
   This is intentional — the scoped run is "just this one slice"
   semantics. If a future check needs baseline context, the
   caller should run unscoped (or pass `--check baseline,<name>`
   once a "baseline" pseudo-name is added).

4. **The `knowledge-sources.yaml` v2 manifest takes precedence
   over v1's `substrate.config.json#knowledge.sources`.** If a
   consumer wants the v1 behaviour even with a v2 manifest
   present, they delete the manifest. No "downgrade flag."

5. **kubernetes Secret + ConfigMap blocks emit KEYS ONLY.** The
   tests pin this explicitly (assertion: rendered output never
   contains the secret value). This is a release-blocking
   contract — do not change the plugin to surface values.

### Don't do these

1. **Don't run `npm publish` from any agent run.** Per hard rule
   #4. The release-checklist documents what Beau runs.

2. **Don't push to GitHub from any agent run.** Per hard rule
   #3. The op4z org recovery is open.

3. **Don't bump the telemetry schema version (`v: 2`) without
   a forbidden-fields change.** B3's design decision #4 is the
   anchor — adding new event fields stays within `v: 2`'s
   contract.

4. **Don't introduce new dependencies in v2.x without a
   concrete need.** B2/B3/B4 maintained the "no new runtime
   deps" discipline. The cron parser, glob expander, and
   knowledge-source plugins are all in-house.

5. **Don't ship a v3.0.0 surface inside a v2.x bump.** The
   `schema_version: v2.0` field on workflow manifests pins the
   contract; v2.x minors can extend, not break. A v3.0 would
   need a codemod for v2 → v3 manifest migration (mirroring
   the v1 → v2 model: additive only when possible).

---

## Versions installed (forensic record)

No new dependencies added in B4. All versions unchanged from
B1+B2+B3:

```
ajv@8.20.0
ajv-formats@3.0.1
yaml@2.9.0
commander@12.1.0
kleur@4.1.5
zod@4.4.3
@inquirer/prompts@7.0.0
```

`package.json` dependencies are unchanged. Only `version` fields
bumped.

---

## Acceptance criteria status

Scored against B4 exit conditions from the brief.

| Criterion                                                                                          | Status      |
| -------------------------------------------------------------------------------------------------- | ----------- |
| `substrate doctor` includes 4 new checks + B3's memory-frontmatter                                 | **met**     |
| Plural knowledge sources: docker-compose + kubernetes + env-registry shipped; plugin contract docs | **met**     |
| `substrate query sessions` CLI command works                                                       | **met**     |
| Docs site v2.0 builds cleanly; new pages cover all 11 primitives                                   | **met** (workflows page covers P1-P8; proposals page covers P9; knowledge-sources page covers P11; commands page covers P10 + others) |
| Proposal pipeline gets its own explainer page on the docs site                                     | **met** (`/proposals/`) |
| `CHANGELOG.md` has `[2.0.0]` section                                                               | **met**     |
| `docs/migration-from-1.x.md` exists                                                                | **met**     |
| `docs/release-2.0-checklist.md` exists                                                             | **met**     |
| `package.json` version bumped to `2.0.0`                                                           | **met** (both packages/substrate and root) |
| `npm pack` produces a clean `op4z-substrate-2.0.0.tgz`                                             | **met** (432 KB, 568 files) |
| Tarball verified manually: `substrate --help` works; `substrate --version` reports 2.0.0           | **met** (verified in /tmp/substrate-pack-test) |
| All gates green: build, lint, typecheck, test, docs-site build                                     | **met**     |
| Test count growth documented (starting at 573)                                                     | **met** (+35 → 608)         |
| v1.0 surface tests still pass (regression check)                                                   | **met** (every pre-v2 test still in the suite) |
| HANDOFF written                                                                                    | **met** (this file)         |

---

**Phase B4 complete. Substrate v2.0 is GA-ready locally.**

**Awaiting Beau's publish action.** See
`docs/release-2.0-checklist.md` for the publish playbook and
`/home/beaug/dev/public/substrate/.agent/HANDOFF-2026-05-15-v2.md`
for the v2.0 milestone summary tying together the entire B1 → B4 arc.

---

*End of HANDOFF. Tag in the parent agent for the v2 milestone
HANDOFF and the publish action.*
