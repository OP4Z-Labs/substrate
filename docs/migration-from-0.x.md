# Migrating from substrate 0.x to 1.0

> **Status:** v1.0 release. Document the exhaustive set of breaking
> changes since v0.x. Most consumers will find the migration is
> backward-compatible — substrate preserves the v0.x config and manifest
> shapes by design.

## TL;DR

```bash
# 0. Update substrate.
npm install -g @op4z/substrate@1

# 1. Run doctor — verifies your environment.
substrate doctor

# 2. Run the migration helper.
substrate audit --strict     # surfaces any RULES.yaml fields that need attention

# 3. If you have a RULES.yaml, review the new detector contract.
# (See "RULES.yaml changes" below.)

# 4. You're done. Re-run your standard substrate workflow.
```

If nothing in this document says "breaking," your project keeps
working unchanged.

---

## Versions covered

| From   | To   | Notes                                              |
| ------ | ---- | -------------------------------------------------- |
| 0.1    | 1.0  | Skeleton → full feature surface. Most changes are additive. |
| 0.3    | 1.0  | Stack auto-detection unchanged; content layer expanded. |
| 0.5    | 1.0  | Upgrade flow + adapters unchanged; detector runtime is new. |
| 0.8    | 1.0  | Most relevant migration source. See sections below. |

---

## Breaking changes (v0.x → v1.0)

### 1. `substrate audit` runs the detector runtime, not the instruction stub

**v0.x behavior.** `substrate audit --type pre-merge` loaded the
instruction Markdown file and printed a stub message ("the executor
ships in v0.5 / v0.8 / v1.0"). It never ran detectors.

**v1.0 behavior.** `substrate audit` (no `--type`) runs the actual
detector runtime against `substrate/RULES.yaml`. The `--type` legacy
flag still works for the instruction-file surface, but it now
explicitly says "use `substrate audit` to run rules."

**Migration:**

- If you previously relied on `substrate audit --type X` printing a stub,
  update your scripts to either:
  - Use `substrate audit --type X` explicitly (legacy, still works).
  - Use `substrate audit` for the new runtime.
- If you have a `substrate/RULES.yaml`, the new runtime EXECUTES it. Make
  sure it's reviewed before running in CI.

### 2. `detector.type: shell` is deprecated

**v0.x.** RULES.yaml supported a `shell` detector type that invoked an
arbitrary shell command.

**v1.0.** The `shell` type still loads (for backward compatibility) but
the runtime treats it as a no-op with a warning. Replace with `script`
(JS file in a sandboxed worker) or `ripgrep`.

**Migration:**

```yaml
# Before (v0.x)
detector:
  type: shell
  command: 'grep -L "USER " apps/*/Dockerfile'

# After (v1.0) — ripgrep
detector:
  type: ripgrep
  pattern: '^USER '
  paths: ['apps/*/Dockerfile']
  # The rule fires when the pattern is ABSENT — combine with a composite
  # rule for the inverse, or use a script detector for complex logic.

# After (v1.0) — script
# detector:
#   type: script
#   path: substrate/detectors/dockerfile-user.mjs
```

### 3. RULES.yaml schema is validated

**v0.x.** RULES.yaml fields were loosely typed; bad fields silently
shipped.

**v1.0.** Required fields (`id`, `title`, `severity`) are enforced.
`severity` must be one of `critical | high | medium | low`. Duplicate
IDs are a hard error.

**Migration:**

```bash
substrate audit --strict   # lists every problem in your current RULES.yaml
```

Address each problem before running without `--strict`.

### 4. Audit reports land in `substrate/audits/` (not `auto/audits/`)

**v0.x.** No audit report files (the executor was a stub).

**v1.0.** Reports land at `substrate/audits/<scope>-YYYY-MM-DD.md` plus
`<scope>-latest.json` and `_trend.jsonl`.

**Migration:** Add `substrate/audits/` to `.gitignore` if you don't want
the reports in your repo (most teams DO want them — they make trend
analysis trivial).

---

## Non-breaking changes worth knowing about

### `substrate telemetry show / purge / export`

The opt-in telemetry surface from v0.8 (`substrate config --telemetry
on|off`) is unchanged. v1.0 adds three transparency commands. See
[docs/telemetry-transparency.md](telemetry-transparency.md).

### `substrate uninstall`

New in v1.0. Removes substrate-managed files with a dry-run mode + hash
check to preserve user edits. See `substrate uninstall --help`.

### `--telemetry-endpoint <url>`

New in v1.0. Lets you forward telemetry events to your own collector.
Off by default; opt-in.

### `--json` is everywhere

Every command that produces human output now also accepts `--json`.
Mid-pipeline tooling can rely on structured output across the board.

### Programmatic API exported

Substrate now exports the command functions for programmatic use. See
[docs/programmatic-api.md](programmatic-api.md). The CLI is still the
primary surface; the API is for when you want to embed substrate.

### 21 standards docs ship with pragmatic bodies

In v0.3, the 21 standards docs scaffolded as TODO stubs. v1.0 ships
~200-300 line opinionated bodies for each. Re-scaffolding a doc you
already customized will preserve your version (manifest hash check
during `substrate add standard <name>`).

If you want the new content:

```bash
substrate add standard backend/architecture --overwrite
```

Confirm the prompt; substrate merges your manifest entry.

---

## Configuration schema

The v1.0 schema is documented in detail in
[docs/config-schema-v1.md](config-schema-v1.md). The schema is frozen
at v1.0 — any breaking change waits for v2.

Existing `substrate.config.json` files from v0.x continue to work
unchanged. The new optional fields (`extensions.taskAdapter`,
`bridges.mcp`, `knowledge`) have safe defaults.

---

## CI integration

The GitHub Action (`BeauGoldberg/@op4z/substrate@v1`) is backward-compatible
with the v0.8 action shape. Inputs and outputs unchanged.

If you pinned `BeauGoldberg/@op4z/substrate@v0.8`, you can either:
- Stay on `@v0.8` (it continues to work).
- Bump to `@v1` for the new detector runtime.

The action's `version` input (the substrate CLI version) defaults to
`latest`. To pin the CLI version explicitly:

```yaml
- uses: BeauGoldberg/@op4z/substrate@v1
  with:
    version: "1.0.0"
    command: "audit --diff"
```

---

## Codemods / helper scripts

```bash
# Detect deprecated shell detectors
grep -rn "type: shell" substrate/RULES.yaml auto/RULES.yaml 2>/dev/null

# Quick sanity check on the audit runtime
substrate audit --strict --no-report

# Dry-run the uninstall to see what's tracked
substrate uninstall --dry-run
```

---

## Reporting migration issues

If you hit a path that's not covered here, [open a GitHub issue](https://github.com/op4z/substrate/issues/new?template=bug_report.yml)
with the `migration` label. We'll either:

- Document the gap in this guide.
- Add a codemod / helper to the CLI.
- Land a backward-compatible escape hatch.

The v1.0 promise is that migration from v0.8 is mechanical — file a
bug if it isn't.
