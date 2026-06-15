# Substrate v3 Enterprise Smoke Test — procedures

> **Audience:** anyone preparing to pitch Substrate's enterprise pattern,
> or anyone investigating an `extends`-primitive regression.
> **Scope:** v3.0.0-beta.1 (NE-11 — the `extends` primitive).
> **Runtime:** under 30s on a warm laptop; under 60s on a cold CI runner.

---

## 1. Purpose

Substrate v3.0 introduces the `extends` primitive: a consumer's
`substrate.config.json` can declare upstream substrate-content sources
(`npm:`, `github:`, `file:`) and the runtime merges per-kind with
"repo-local wins" collision semantics. This document codifies the
end-to-end smoke procedure that proves the primitive works against
the **packaged tarball** (not the dev source) — the exact path an
enterprise adopter would take.

The smoke validates four layers:

| Layer | What it proves |
| ----- | -------------- |
| 1 — Fixture setup | The org-hub + consumer-repo shapes from the Phase 1 playbook are buildable from a reference fixture |
| 2 — Extends resolution | `substrate extends` resolves npm + github + file sources, surfaces provenance, applies repo-local override semantics |
| 3 — Daily-driver surface | The CLI commands an adopter runs every day work against the composed setup |
| 4 — Integration + regression | MCP server starts cleanly with 7 tools; v2-shaped consumers (no `extends` field) regress nowhere; edge cases produce graceful errors |

If all 16 scenarios pass, the v3.0 primitive is on the same quality
floor as the v2.0 baseline (778 tests + 1 skipped, all green; v3
beta.1 adds 17 new tests for an effective 795 + 1 skipped baseline).

---

## 2. Pre-test setup

Required on the test machine:

- **Node.js 20+** — `engines.node` minimum.
- **npm** — bundled with Node.
- **jq** — for JSON assertions. `apt-get install jq` / `brew install jq`.
- **git** — only needed for the `github:` source scenario; the script
  honors `SMOKE_SKIP_GITHUB=1` to bypass.
- Outbound network access for the github source (unless skipped).
- The packaged tarball at
  `packages/substrate/op4z-substrate-3.0.0-beta.1.tgz`. The script
  auto-builds it via `npm pack` if missing.

No other system prerequisites. The smoke script creates its own
ephemeral working directory under `/tmp/substrate-smoke-XXXXXX/` and
cleans up on exit.

### Sanity check before running

```bash
cd /path/to/substrate
node --version            # >= v20
npm --version             # any recent
jq --version              # jq-1.6 or later
ls packages/substrate/op4z-substrate-3.0.0-beta.1.tgz   # exists, or:
( cd packages/substrate && npm pack )                    # build it
```

---

## 3. Running the smoke

Three invocation modes — all equivalent:

```bash
# 1. From the repo root via npm script (recommended)
npm run smoke:enterprise

# 2. From the package directory
cd packages/substrate
npm run smoke:enterprise

# 3. Directly via bash
bash packages/substrate/tests/smoke/enterprise-smoke.sh
```

### Environment knobs

| Variable | Default | Effect |
| -------- | ------- | ------ |
| `SMOKE_SKIP_GITHUB=1` | unset | Skip scenario 5/6 github source paths. Useful for offline runs. |
| `SMOKE_FAIL_FAST=0` | `1` | Continue past failing scenarios instead of exiting on the first. |

### Expected stdout (passing run)

```
Pre-flight: node v22.20.0, npm 10.9.0, jq jq-1.7
Workspace: /tmp/substrate-smoke-XXXXXX

[OK] Scenario 1: fixture copied + consumer installed from tarball
[OK] Scenario 2: extends list reports correct per-layer counts + provenance
[OK] Scenario 3: extends list --json envelope is structurally correct
[OK] Scenario 4: per-repo overrides at 5 kinds: all collisions report repo-local as winner
[OK] Scenario 5: npm: + file: + github: sources resolve through the chain
[OK] Scenario 6: SUBSTRATE_OFFLINE=1: npm + file still resolve; github cold-cache skipped
[OK] Scenario 7: doctor runs clean against the composed setup (expected v2 warns documented)
[OK] Scenario 8: daily-driver CLI surface is extends-aware: query rules/standards/doc-checks + hooks list return merged content
[OK] Scenario 9: substrate run resolves org-shared workflow directly via extends chain
[OK] Scenario 10a: mcp serve responds to initialize + tools/list with 7 tools
[OK] Scenario 10b: v2-shaped consumer (no extends field) still works
[OK] Scenario 10c: version surface: substrate -v + tarball + CHANGELOG entry all at 3.0.0-beta.1
[OK] Scenario 10d: edge cases: malformed URL → error; missing → exit 1; circular → silent (no transitive)
[OK] Scenario 10e: substrate audit resolves rules from org-shared via extends chain (executedRules=10)
[OK] Scenario 10f: tarball includes CHANGELOG.md; extends clear-cache --json emits a structured envelope
[OK] Scenario 10g: extends.opt-out hides selected sources; --include-opt-out bypasses the filter

Elapsed: 20s

---
Scenarios passed: 13
Scenarios failed: 0
Workspace (cleaned on exit): /tmp/substrate-smoke-XXXXXX
```

Exit code 0 on full pass; nonzero otherwise.

---

## 4. Scenarios — what each one tests

Each scenario corresponds to a section in `enterprise-smoke.sh`. The
expected-output snippets below are the assertion anchors — the
`grep` / `jq -e` calls that determine pass/fail.

### Layer 1 — Fixture setup

#### Scenario 1 — Cold start

**What:** Copy
`tests/smoke/fixtures/substrate-shared-fixture/` to
`/tmp/substrate-smoke-*/substrate-shared/`. Initialize a parallel
consumer repo at `/tmp/substrate-smoke-*/consumer/` with a
`substrate.config.json` declaring `extends: [{ "source": "file:..." }]`.
Install `substrate` from the tarball.

**Anchors:**
- `${ORG_DIR}/substrate/workflows`, `hooks`, `doc-checks`, `standards`
  directories must exist.
- `${ORG_DIR}/substrate/RULES.yaml` must exist.
- `${CONSUMER_DIR}/substrate.config.json` must exist.
- `${CONSUMER_DIR}/node_modules/.bin/substrate` must be executable.

### Layer 2 — Extends resolution

#### Scenario 2 — `substrate extends list`

**Command:**

```bash
cd ${CONSUMER_DIR} && ./node_modules/.bin/substrate extends list
```

**Expected stdout includes** (numbers are the org-hub fixture's
authored contribution):

```
Resolved extends sources (order: base → repo-local):

[1] file:/tmp/substrate-smoke-XXXXXX/substrate-shared
    Path: /tmp/substrate-smoke-XXXXXX/substrate-shared
    workflows: 3  hooks: 3  doc-checks: 3  standards: 5  RULES: 10 rows

[2] (repo-local)
    Path: /tmp/substrate-smoke-XXXXXX/consumer
    workflows: 0  hooks: 0  doc-checks: 0  standards: 0  RULES: 0 rows

Effective registry: 3 workflows · 3 hooks · 3 doc-checks · 5 standards · 10 RULES rows
```

**Anchors:**
- The `file:${ORG_DIR}` source string is present.
- `(repo-local)` is present.
- The `workflows: 3  hooks: 3  doc-checks: 3  standards: 5  RULES: 10 rows`
  line matches the org layer.
- The `Effective registry: 3 workflows` line matches the aggregated total.

#### Scenario 3 — `substrate extends list --json`

**Command:**

```bash
cd ${CONSUMER_DIR} && ./node_modules/.bin/substrate extends list --json
```

**Expected JSON shape:**

```json
{
  "layers": [
    { "source": "file:...", "kind": "file", "root": "...",
      "counts": { "workflows": 3, "hooks": 3, "docChecks": 3, "standards": 5, "rules": 10 } },
    { "source": "repo-local", "kind": "local", "root": "...",
      "counts": { "workflows": 0, "hooks": 0, "docChecks": 0, "standards": 0, "rules": 0 } }
  ],
  "effective": { "workflows": 3, "hooks": 3, "docChecks": 3, "standards": 5, "rules": 10 },
  "collisions": [],
  "errors": [],
  "warnings": [],
  "exitCode": 0
}
```

**Anchors (jq):**
- `.layers | length == 2`
- `.layers[0].kind == "file"`
- `.layers[1].kind == "local"`
- `.effective.workflows == 3`
- `.effective.rules == 10`
- `.collisions | length == 0`
- `.exitCode == 0`

#### Scenario 4 — Per-repo overrides at all 5 kinds

**What:** Write one repo-local override per kind into
`${CONSUMER_DIR}/substrate/`:
- workflow: `org-audit-pre-merge.yaml`
- hook: `auto-emit-sidecar.yaml`
- doc-check: `changelog-on-feat-or-fix.yaml`
- standard: `backend/python.md`
- rule: `ORG-BE-PY-001` in `RULES.yaml`

**Anchors (jq):**
- `.collisions | length == 5`
- For each `class` in `[workflow, hook, doc-check, standard, rule]`:
  `.collisions[] | select(.class == "$class") | .winner == "repo-local"`
- `.effective.workflows == 3` (overrides don't grow the registry)
- `.effective.rules == 10`

#### Scenario 5 — All three source kinds

**What:** Switch the consumer config to:

```json
{
  "extends": [
    { "source": "npm:@acme/substrate-shared" },
    { "source": "file:..." },
    { "source": "github:octocat/Hello-World", "ref": "master" }
  ]
}
```

`npm:` — installs the fixture via `npm install --no-save` so it lands
in `node_modules/@acme/substrate-shared/`.

`file:` — same overlay used in earlier scenarios.

`github:` — uses the well-known public repo `octocat/Hello-World`.
It contains no substrate content, but the **source-kind plumbing**
is exercised (clone, cache, manifest write).

**Anchors (jq):**
- `[.layers[] | select(.kind == "npm")] | length == 1`
- `[.layers[] | select(.kind == "file")] | length == 1`
- `[.layers[] | select(.kind == "local")] | length == 1`
- For github: either a layer exists OR an error is recorded
  (depending on network availability and git binary). Both are
  acceptable: this scenario validates the dispatch path, not
  necessarily a successful network call.

**Skip flag:** set `SMOKE_SKIP_GITHUB=1` to bypass the github source
entirely on machines without outbound network.

#### Scenario 6 — Air-gap behavior (`SUBSTRATE_OFFLINE=1`)

**What:** Clear the github cache, then re-run `extends list --json`
with `SUBSTRATE_OFFLINE=1` set.

**Locked semantic (HANDOFF design decision 6):**

| Cache state | Outcome |
| ----------- | ------- |
| Cold cache + `SUBSTRATE_OFFLINE=1` | Warning logged + github layer skipped |
| Warm cache + `SUBSTRATE_OFFLINE=1` | Cache hit served; no warning |

**Anchors (jq):**
- `[.layers[] | select(.kind == "npm")] | length == 1` — npm survives offline
- `[.layers[] | select(.kind == "file")] | length == 1` — file survives offline
- For github (when not skipped): either a `SUBSTRATE_OFFLINE`-bearing
  warning is present OR the github layer is absent. Both are pass
  conditions; the script accepts either.

### Layer 3 — Daily-driver surface

#### Scenario 7 — `substrate doctor`

**Command:**

```bash
cd ${CONSUMER_DIR} && ./node_modules/.bin/substrate doctor
```

**Anchors:**
- Output contains a `Summary: N ok, M warn, K error` line.
- `✓ substrate.config.json` passes.
- `✓ Node.js runtime` passes.

**Documented expected warns / errors** (NOT failures of the smoke):
- `✗ auto/ directory — Missing` — the consumer doesn't run `substrate init`.
- `! auto/.substrate-manifest.json — Missing` — same root cause.

Per the V3-NE11 HANDOFF, these are v2.0 baseline warns that surface
in any tempdir-style consumer. They are NOT regressions; the smoke
only asserts that `doctor` produces a Summary line and the core
checks (config + runtime + git) pass.

#### Scenario 8 — Daily-driver CLI surface

**Commands exercised** (with exit-code-only assertions):

- `substrate extends list --json` — exit 0
- `substrate extends sync --json` — exit 0 (file: source is a no-op)
- `substrate extends clear-cache` — exit 0
- `substrate validate` — must say "manifest(s) valid"
- `substrate query rules --json` — `.rules.length >= 10` (merged set
  from org RULES.yaml)
- `substrate query standards --for-files src/foo.py --json` —
  `.standards[]` includes `backend/python.md` (repo-local override of
  the org version)
- `substrate query doc-checks --for-files src/foo.py --json` —
  `.registry.length >= 3` (merged set from org doc-checks)
- `substrate hooks list --json` — `.hooks.length >= 3` (merged set
  from org hooks)

**EXTENDS-AWARENESS (as of v3.0.0-beta.1):** `substrate query`,
`substrate hooks list`, `substrate audit`, and `substrate run` all
route through the v3 merge wrappers — they see the merged registry
(org-shared + repo-local). v2-shaped consumers (no `extends` field)
see identical behavior to v2.x because the wrappers collapse to a
single-layer chain.

#### Scenario 9 — `substrate run` resolves org-shared workflow

**What:** With NO repo-local copy of the workflow file present, run
the workflow declared only in the file: extends source.

```bash
cd ${CONSUMER_DIR} && ./node_modules/.bin/substrate run org-git-review-pre
```

**Anchors:**
- Output contains the marker string `org-shared:org-git-review-pre OK`
  emitted by the workflow's deterministic step.
- The smoke explicitly asserts the workflow does NOT exist at
  `${CONSUMER_DIR}/substrate/workflows/org-git-review-pre.yaml`
  before running — so a passing result proves extends-resolution
  worked, not a stale-copy fallback.

### Layer 4 — Integration + regression

#### Scenario 10a — `substrate mcp serve`

**What:** Spawn `substrate mcp serve`, send a JSON-RPC `initialize`
+ `notifications/initialized` + `tools/list` handshake over stdio.

**Anchors:**
- `initialize` response includes `"id":1` and
  `"serverInfo":{"name":"substrate"`.
- `tools/list` response contains exactly 7 unique tool names matching
  `substrate_*`. Locked names:
  - `substrate_audit_list`
  - `substrate_audit_run`
  - `substrate_knowledge_show`
  - `substrate_doctor`
  - `substrate_workflow_list`
  - `substrate_workflow_describe`
  - `substrate_upgrade_check`

If a future version adds or removes tools, update the expected count
in `scenario_10a` and document the change in the CHANGELOG.

#### Scenario 10b — v2-shaped consumer regression

**What:** Create a parallel consumer
`${V2_CONSUMER_DIR}/substrate.config.json` with `version: "v2.0"`
and **no `extends` field**, install substrate from the tarball, run
`extends list --json`.

**Anchors (jq):**
- `.layers | length == 1` — just repo-local
- `.layers[0].kind == "local"`
- `.exitCode == 0`

This proves the headline v3 claim: zero migration required for
v2.0 consumers.

#### Scenario 10c — Version surface

**Anchors:**
- `substrate --version` returns exactly `3.0.0-beta.1`.
- Tarball's `package/package.json .version` is `3.0.0-beta.1`.
- Root `CHANGELOG.md` contains a `## [3.0.0-beta.1]` heading.

**Documented gap:** the tarball does NOT include `CHANGELOG.md`.
The `files` whitelist in `packages/substrate/package.json` covers
`dist`, `templates`, `templates-history`, `schemas`, `README.md`,
`LICENSE` — no CHANGELOG. The CHANGELOG lives at the workspace
root, not the package root. This was true in v2.0.0 too;
unchanged by NE-11. Logged for the next packaging pass.

#### Scenario 10d — Edge cases

**Three sub-checks:**

1. **Malformed scheme:** config with `{ "source": "invalid-scheme:foo/bar" }`
   — schema validates that against the pattern. Should produce a
   human-readable `Unknown extends source kind` error and exit 1.

2. **Missing file: source:** config with
   `{ "source": "file:/this/path/does/not/exist/abc123" }`.
   Should produce a JSON `errors[]` entry and exit 1.

3. **Circular extends:** A → B → A via two `file:` sources.
   Per HANDOFF item 3, v3.0.0-beta.1 does NOT read transitive
   extends — B's `extends` back to A is silently ignored. Should NOT
   crash. Expected `exitCode == 0`.

---

## 5. Success gate per layer

| Layer | Pass criterion |
| ----- | -------------- |
| 1 | Scenario 1 passes |
| 2 | Scenarios 2-6 pass |
| 3 | Scenarios 7-9 pass |
| 4 | Scenarios 10a-10d pass |

A full smoke pass is the gate for declaring v3.0.0-beta.1
adoption-ready (against the documented gaps in §8).

---

## 6. Troubleshooting tree

### Pre-flight failures

**`required command not found on PATH: jq`** — install jq.

**`Tarball missing`** — the script auto-builds via
`cd packages/substrate && npm pack`. If that fails, run it
manually and check stderr.

**`fixture not found at .../substrate-shared-fixture`** — the
fixture directory was deleted or moved. Restore via
`git checkout packages/substrate/tests/smoke/fixtures/`.

### Scenario failures

#### Scenario 1 fails — `substrate binary not installed`

Likely npm install error. Re-run with stderr visible:

```bash
cd /tmp/substrate-smoke-XXX/consumer
npm install --verbose path/to/op4z-substrate-3.0.0-beta.1.tgz
```

Common causes: corrupted tarball (rebuild via `npm pack`), missing
network for transitive deps, npm cache lock.

#### Scenarios 2 or 3 fail — count mismatch

The fixture content drifted. Verify with:

```bash
cd packages/substrate/tests/smoke/fixtures/substrate-shared-fixture
ls substrate/workflows/    # expect 3 yaml files
ls substrate/hooks/        # expect 3 yaml files
ls substrate/doc-checks/   # expect 3 yaml files
find substrate/standards -name "*.md" | wc -l   # expect 5
grep -c "  - id:" substrate/RULES.yaml          # expect 10
```

If any number is off, the fixture has been edited. Either revert
or update the smoke script's expected counts in scenarios 2-4.

#### Scenario 4 fails — collision count != 5

A repo-local override file is malformed (so the discoverer skipped
it) or the override file's id doesn't match the org's id (so no
collision). Re-read scenario_4 in the script and verify each YAML
manifest's `id:` matches the corresponding org file.

#### Scenario 5 fails — `npm: layer not in resolved chain`

The fake-npm-install step failed. Verify:

```bash
ls /tmp/substrate-smoke-XXX/consumer/node_modules/@acme/substrate-shared/substrate
```

If the directory is missing, the `npm install --no-save` of the
fixture failed. Check stderr at
`/tmp/substrate-smoke-XXX/extends-list-stderr.log`.

#### Scenario 5 fails — `github: source did not produce a layer or an error`

Outbound network may be blocked. Re-run with
`SMOKE_SKIP_GITHUB=1` to confirm the rest is healthy, then debug
network separately.

#### Scenario 6 fails — `github: cold cache + offline should produce a SUBSTRATE_OFFLINE warning`

Verify the cache was actually cleared before the offline list:

```bash
ls /tmp/substrate-smoke-XXX/consumer/substrate/.cache/extends/github/
# Should be empty
```

If not empty, the `extends clear-cache` step failed silently —
check stderr at
`/tmp/substrate-smoke-XXX/extends-clear-stderr.log`.

#### Scenario 9 fails — `deterministic workflow did not produce the org-shared marker`

The workflow's deterministic step (`echo "org-shared:org-git-review-pre OK"`)
didn't fire. Check that the workflow YAML's `steps[].run` field
is intact and the step engine didn't error out. Run with
`--dry-run` first to inspect:

```bash
substrate run org-git-review-pre --dry-run
```

#### Scenario 10a fails — `expected 7 substrate_* tools, got N`

The MCP tool registry changed. This is intentional if a new tool
was added — update the expected count in `scenario_10a`. If
unintentional, check the MCP server bootstrap in
`packages/substrate/src/cli/mcp/`.

#### Scenario 10c fails — `tarball package.json version != 3.0.0-beta.1`

The tarball is stale. Rebuild:

```bash
cd packages/substrate && rm -f op4z-substrate-3.0.0-beta.1.tgz && npm pack
```

#### Scenario 10d fails — circular extends crashed

This is a real bug. v3.0.0-beta.1 doesn't resolve transitively, so
A → B → A should be silent. If you see a crash, capture the stderr
log at `/tmp/substrate-smoke-XXX/s10d-circ-stderr.log` and file a
follow-up — likely a regression in `resolver.ts`.

---

## 7. How to extend the test when new primitives ship

When a new substrate primitive lands in v3.0.0-beta.1+:

1. **Update the fixture** at
   `tests/smoke/fixtures/substrate-shared-fixture/` to include
   representative content for the new primitive. Keep the fixture
   minimal (1-3 files per primitive — the smoke is fast).

2. **Add a new scenario function** in `enterprise-smoke.sh` following
   the same pattern: invoke the CLI, assert on stdout/exit-code/JSON
   shape with `grep` or `jq -e`, `fail`/`pass` accordingly.

3. **Register the function** in the "Run everything" block at the
   bottom of the script.

4. **Document the scenario** in this file's §4 with command +
   expected output anchors + troubleshooting entry.

5. **Update CI matrix budget** if the new scenario raises total
   runtime beyond 30s.

For new CLI commands that become extends-aware (closing the
Scenario 8 gap), update the existing scenario_8 assertions to
verify merged output, not just exit codes.

---

## 8. What this DOESN'T cover

Be honest about the gaps:

### Real GitHub network failure modes

Scenario 5 exercises a successful clone of a tiny public repo, and
scenario 6 exercises the offline path. The smoke does NOT cover:
- Auth failures (private repos, expired SSH keys).
- Rate-limit responses from GitHub.
- Network partitions mid-clone.
- Mirror redirects or git http proxies.

These are operational concerns; the integration test
`tests/v3-extends-integration.test.ts` covers them via an injected
`gitRunner`.

### Real AI session integration

Scenario 9 runs a deterministic-only workflow. Workflows with
`prompt` or `gate` steps (the AI session path) are NOT exercised
by the smoke. Validation of the AI path requires a real session
host (Claude Code, Cursor, etc.) — out of CI scope.

### Real npm registry

Scenario 5's `npm:` source is a `file:` install of the fixture
masquerading as an `@acme/substrate-shared` package. The smoke
does NOT publish to a registry or install from one. Publish
flow is validated separately at release time
(`docs/release-checklist.md`).

### Transitive extends (an extends source that itself has extends)

Per HANDOFF item 3, v3.0.0-beta.1 reads only one level. Scenario
10d verifies the non-crash behavior for a circular case, but
multi-level resolution is NOT a feature in beta.1. When
transitive support lands, scenarios 5 + 10d should grow to cover it.

### Cross-platform shell compatibility

The script is bash-only. macOS bash 3.2 and Linux bash 4+ have
both been tested; Windows PowerShell is NOT supported. CI runs on
`ubuntu-latest` only. Adopters on Windows must use WSL.

### MCP tool execution (vs. just listing)

Scenario 10a verifies `tools/list` returns 7 tools. The smoke does
NOT call individual tools (e.g. `substrate_audit_run`). Tool-call
correctness is covered by `tests/mcp.test.ts` and
`tests/integration/mcp.test.ts`.

### Performance regressions

The smoke records elapsed wall-clock but does not assert against a
budget. CI matrix can run on warm runners (5s scenarios) or cold
ones (30s scenarios); the spread is too wide for a hard assertion.
Drift signals would come from the nightly schedule, manually
compared.

---

## 9. File map

| Artifact | Purpose |
| -------- | ------- |
| `packages/substrate/tests/smoke/fixtures/substrate-shared-fixture/` | Canonical reference fixture (committed) |
| `packages/substrate/tests/smoke/enterprise-smoke.sh` | The bash smoke script |
| `packages/substrate/package.json` `scripts.smoke:enterprise` | Per-package npm entry point |
| `package.json` `scripts.smoke:enterprise` | Root-level npm entry point (delegates to the package) |
| `.github/workflows/enterprise-smoke.yml` | CI workflow (PR + nightly + workflow_dispatch) |
| `docs/SMOKE-TEST-ENTERPRISE.md` | This document |
| `.agent/V3-SMOKE-2026-05-16.md` | HANDOFF — per-scenario evidence + bugs found |

---

## 10. Related references

- **V3 NE-11 HANDOFF:** `.agent/V3-NE11-2026-05-16.md` — extends
  primitive design notes, open questions, deferred items.
- **Phase 1+2 enterprise plan:** `docs/plans/substrate-phase-1-2-enterprise-plan.md`
  (out-of-tree in TheNexusProject repo) — the org-rollout playbook
  this fixture models.
- **CHANGELOG entry:** `CHANGELOG.md` §[3.0.0-beta.1] — full list
  of changes shipped in NE-11.
- **Integration test:** `tests/v3-extends-integration.test.ts` —
  vitest-driven counterpart to this smoke (exercises the merge
  semantics via the programmatic API with a fake `gitRunner`).
