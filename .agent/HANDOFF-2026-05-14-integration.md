# Cadence v0.3.1 — Integration-Test Conversion Handoff (2026-05-14)

Conversion of the 2026-05-14 smoke-test steps into a permanent vitest
integration suite. The 12 smoke-test concerns now ship as 23 automated
test cases that run on every commit; future milestones don't need a
manual smoke pass to know the CLI's documented surface still works.

---

## Conversion summary

- **Smoke steps converted:** 12 / 12 (the entire Cadence section of
  `.agent/SMOKE-2026-05-14.md`). Each smoke step maps to one or more
  `it()` blocks that mirror the smoke report's wording in the test
  name.
- **New tests added:** 23 across 5 spec files in `tests/integration/`.
  Plus 2 harness modules (`helpers.ts`, `global-setup.ts`) that aren't
  test files but are required infrastructure.
- **Pre-conversion test count:** 85 (10 unit files).
- **Post-conversion test count:** 108 (10 unit files + 5 integration
  files = 15 total files).
- **CI workflow:** new `.github/workflows/ci.yml` added (no CI
  previously). Matrix on node 20 + 22. Steps: install → lint →
  typecheck → test → build.
- **Time elapsed:** ~50 minutes wall.
- **Gates:** lint / tsc -b / vitest run / build all green on every
  commit boundary.

### Commits landed

```
f63a61c docs: testing section in README
56a00c8 ci: run integration tests in vitest
730c047 test(integration): doctor health checks (smoke step 10)
f9cf91a test(integration): knowledge refresh + show (smoke steps 8, 9)
d328dbc test(integration): add subcommands + idempotency (smoke steps 5-7, 12)
fbd93e4 test(integration): audit list/type/spot-check (smoke steps 2, 3, 4)
956f3f6 test(integration): init + stack detection (smoke steps 1, 11)
```

All commits local. **Not pushed** per the brief's git posture.

---

## Tests created

### `tests/integration/init.test.ts` (4 tests)

**Smoke steps covered:** 1, 11.

- `smoke 1: cadence init --with-claude scaffolds the full v0.1 surface` —
  asserts exit 0, all seven `auto/` subdirs, `cadence.config.json` with
  project + shortCode, the Claude bridge file, the empty manifest stub,
  and the v0.1 audit trio (`pre-merge`/`dependencies`/`dead-code`).
- `smoke 1: no stack flag + no marker files → fallback default` —
  reproduces the smoke-tested empty-tmp-dir condition. Asserts the
  `fallback default` banner is visible in stdout and the resulting
  config has `["python","typescript"]`.
- `smoke 11: cadence init auto-detects python from bare pyproject.toml` —
  marker file must be written BEFORE `init` runs. Asserts ONLY python
  is in the resulting config (typescript absent).
- `smoke 11: stack-detection log line surfaces auto-detected` — pins
  the human-readable "auto-detected" banner so transparency about
  detection isn't silently dropped.

### `tests/integration/audit.test.ts` (5 tests)

**Smoke steps covered:** 2, 3, 4.

- `smoke 2: audit --list enumerates scaffolded audits + bundled catalog` —
  guards the post-cleanup contract (commit `cbff723`). Default output
  has both "Enabled (scaffolded)" and "Available (catalog)" sections,
  with spot-checks for the v0.1 trio (enabled) and
  backend/frontend/security (catalog).
- `smoke 2: audit --list --json emits the structured envelope` — pins
  the `{ enabled, catalog }` shape and the `scaffolded` flag flip
  between pre-merge (true) and backend (false).
- `smoke 3: audit --type pre-merge returns a structured stub` —
  asserts the stub banner + `Findings:` counter.
- `smoke 3: audit --type stub message references v0.5` — pins the
  e504ce2 forward-looking-version fix. Negative assertion: the stale
  "ships in v0.3" string must NOT appear.
- `smoke 4: audit --type backend fails with actionable error when not
  scaffolded` — non-zero exit + "not found" + "audit-backend.md" +
  "available" + the list of scaffolded audits. The smoke report
  classified this as "expected fail"; the test asserts the failure
  SHAPE so this PASSES when the error handling works.

### `tests/integration/add.test.ts` (5 tests)

**Smoke steps covered:** 5, 6, 7, 12.

- `smoke 5: cadence add audit security scaffolds + records sha256 in
  manifest` — pins the v0.5 upgrade-flow contract: every entry must
  have a `sha256:[0-9a-f]{64}` contentHash, `templateVersion`, and
  `ejected: false`.
- `smoke 6: cadence add standard backend/architecture writes the doc +
  manifest entry` — asserts the nested `<scope>/<area>` path and a
  hashed manifest entry.
- `smoke 6: cadence add standard rejects the . delimiter with
  actionable error` — pins the `ae7fede` skip-decision so the
  canonical-`/` form remains the single accepted delimiter.
- `smoke 7: cadence add scaffold package-ts registers in
  scaffolds.yaml` — asserts the YAML registry contains the entry +
  the manifest tracks the registry file.
- `smoke 12: re-running cadence add audit security preserves the
  existing file` — sentinel-file approach: tamper with the scaffolded
  file, re-run, assert the user edit survives + the
  "exists/preserving/skip" wording shows up.

### `tests/integration/knowledge.test.ts` (4 tests)

**Smoke steps covered:** 8, 9.

- `smoke 8: knowledge refresh parses docker-compose + .env.example
  with redaction` — uses a 3-service inline fixture (api/db/cache).
  Asserts every service round-trips, volumes are surfaced,
  `SECRET_KEY`/`API_TOKEN` are masked, AND the literal sensitive
  values do NOT appear anywhere in the output. **Note:** does NOT
  use OP4Z's real `docker-compose.yml` — see "Bugs found" section
  below for why.
- `smoke 8: knowledge refresh writes the doc even when no sources are
  present` — empty repo → `_No services discovered._` placeholder.
- `smoke 9: knowledge show prints the generated doc` — full doc on
  stdout, all top-level sections visible.
- `smoke 9: knowledge show --section filters to one heading` —
  Services section visible, Environment variables section absent.

### `tests/integration/doctor.test.ts` (5 tests)

**Smoke step covered:** 10.

- `smoke 10: doctor on a freshly-initialized repo passes all checks` —
  exit 0, summary line present (`N ok, M warn, K error` shape), all
  six canonical check titles rendered.
- `smoke 10: doctor on an uninitialized dir reports error + exits
  non-zero` — config.missing fires, summary mentions error.
- `smoke 10: doctor flags declared-but-not-detected stack drift as
  warn` — `init --stack python,go` on a marker-less dir → warn
  surfaces, exit 0 (warns don't fail the gate).
- `smoke 10: doctor --json emits parseable machine output` — JSON
  parses, `exitCode`, `summary`, `checks` array all present.
- `smoke 10: doctor surfaces error severity (exit 1) for a corrupted
  config` — invalid JSON in cadence.config.json → "could not parse"
  in stdout, non-zero exit. Adds coverage beyond the smoke report
  (the smoke run only saw the warn path) since it's the same
  surface and worth pinning.

---

## Harness decisions

### Spawn pattern: `spawnSync(node, [dist/cli.js, ...args])`

**Chosen:** `node:child_process.spawnSync` with `process.execPath` +
the absolute path to `dist/cli.js`.

**Alternatives considered:**

- `tsx src/cli.ts` — faster iteration, no build step needed. **Rejected.**
  The whole point of the integration layer is to catch bugs in the
  *built artifact* — the v0.3 symlink bug (commit `3995a60`) was
  invisible to 84 unit tests because none of them exercised the actual
  dist/. `tsx` would just be a slower unit test.
- `execa` library — better ergonomics, async-by-default, typed output.
  **Rejected.** Adds a new dev-dep for ~30 lines of code we can write
  in stdlib. The brief explicitly said "No new deps unless absolutely
  necessary" and pointed at `child_process` as the preferred path.
- `runCli(...)` could `await` an async spawn. **Rejected** in favor
  of `spawnSync` — every cadence command is a one-shot, no streaming
  needed, and synchronous tests are easier to read.

The `runCli` helper throws (rather than returning) ONLY when Node
fails to spawn at all (ENOENT etc.) — a non-zero exit code is
returned via `result.status` so tests can assert on failure shapes.
This distinction matters: a missing build is loud; an expected
failure (smoke 4) is just data.

### tmpdir strategy: `mkdtempSync(tmpdir + "/cadence-int-")`

One fresh tmp dir per test. Pairs with `removeTmpDir` in `afterEach`.
Prefix is unique enough to identify our collateral if a test crashes
mid-cleanup (`rm -rf /tmp/cadence-int-*` to purge).

No `process.chdir()`. The CLI accepts cwd via `spawnSync`'s options,
which is the correct shape — it also guards against tests accidentally
reading from the test-runner's repo (a real footgun in monorepos).

### Build prerequisite: `globalSetup`

The integration suite has `tests/integration/global-setup.ts` wired
into vitest config via `test.globalSetup`. Runs `npm run build` once
per `vitest run` invocation. The build is incremental (`tsc -b`) so
the no-change case is ~150ms — cheap insurance against running tests
against stale dist/. Fails the suite loudly if the build fails.

### Vitest config changes

- `globalSetup: ["tests/integration/global-setup.ts"]` added.
- `testTimeout: 10000 → 30000`. Subprocess spawns are slower than
  direct function calls; the unit suite (slowest test ~30ms) is
  unaffected, but the slowest integration test (full init + add audit
  + add standard + knowledge refresh + show + doctor in one beforeEach
  flow) can push past the old 10s on a cold runner. 30s gives
  comfortable headroom without masking real flakes.

### Why one combined config, not a separate `vitest.integration.config.ts`

Vitest's default include pattern (`tests/**/*.test.ts`) picks up both
`tests/*.test.ts` and `tests/integration/*.test.ts` transparently.
`npm test` runs both layers in one process; `npm run test:unit`
and `npm run test:integration` provide split execution when needed.

Splitting configs would have meant:
- two `globalSetup` configurations to maintain,
- two coverage profiles to merge,
- two CI matrix entries for what is one logical "test the package" step.

The simple-include path keeps the surface minimal.

### CI invocation

`.github/workflows/ci.yml` runs `npm test` directly. The integration
tests are picked up transparently via vitest's include glob; no
separate `test:integration` step in CI is needed (it would just be a
re-run). The `npm run test:integration` script exists for local-dev
iteration, not for CI.

### npm script glob quoting (gotcha)

`"test:unit": "vitest run --exclude tests/integration/**"` — the
unquoted `**` was shell-expanded into individual filenames before
vitest ever saw it, which silently narrowed the unit run to 4 files
(matching the shell-expanded list) instead of the intended 10. Fix:
quote the glob. This was the one real bug found during this pass;
shipped in commit `f63a61c` alongside the README docs update.

---

## Bugs found during conversion

### None new at the binary surface

Every smoke-step contract passed cleanly through the integration
tests as written. The integration layer is now in place to catch the
next bug at PR time rather than after manual smoke testing.

### One harness-level bug fixed in flight

The `test:unit` script's unquoted `**` glob (described under "Harness
decisions" above) was silently narrowing the unit run. Fixed in the
README docs commit (`f63a61c`). Pre-fix `test:unit` reported 18 tests;
post-fix it reports 85, matching the full unit-suite count.

### P1 carry-over: OP4Z compose yaml-mini bug (deferred to v0.5)

Per the brief, OP4Z's real `docker-compose.yml` would be the natural
fixture for `smoke 8`. The smoke run found (and the cleanup handoff
documented) that the v0.3 `yaml-mini.ts` parser loses all but the
first service when `command: >` block-scalars appear — losing 58/59
OP4Z services.

Locking the integration test against the OP4Z compose today would
ENTRENCH the buggy output rather than catch its fix. Decision: ship
an inline 3-service fixture that exercises the shapes the v0.3 parser
DOES handle, AND document the deferred work in both the test file's
JSDoc and this handoff.

When v0.5 swaps `yaml-mini.ts` for the `yaml` library, a follow-up
test should be added against the real compose path to pin the fix.
See "Notes for the next agent" → "v0.5 carry-overs" below.

---

## Notes for the next agent

### Patterns established for v0.5 integration tests

When v0.5 adds new surfaces (`cadence upgrade`, `cadence review`,
`cadence standards`, `cadence config`, `cadence workflow start`,
etc.), each should land an integration spec alongside its unit
tests. The conventions:

1. **One spec file per command-noun** (`upgrade.test.ts`,
   `review.test.ts`). Sub-flags / variants go inside `describe`
   blocks within that file.
2. **One `it()` per acceptance criterion**, named with the smoke /
   acceptance step it represents. Use the smoke report's wording so
   the test name IS the contract.
3. **Always seed a fresh tmp dir in `beforeEach`**, never reuse
   across tests. Init the repo via `runCli(["init", ...])` if the
   command requires it.
4. **Assert on exit code AND output**, never just one. `result.status`
   for the pass/fail boundary; `result.stdout` / `result.stderr`
   for the UX contract.
5. **Negative assertions on stale strings.** Cadence's stub messages
   reference future versions — when v0.5 ships its executor, the
   audit-stub test's `expect(...).not.toContain("v0.5")` should flip
   to a positive assertion against the new wording. Catching stale
   version references via integration tests is cheap; doing it via
   manual smoke is expensive.

### v0.5 carry-overs

- **YAML library swap** (`yaml-mini.ts` → `yaml` by Eemeli Aro).
  Unblocks the P1 finding. When this lands, add a new integration
  spec `tests/integration/knowledge-op4z.test.ts` (or extend
  `knowledge.test.ts`) that copies OP4Z's real `docker-compose.yml`
  into the tmp dir and asserts the full service count (~59) is
  surfaced. Gate with `process.env.OP4Z_REPO` so it's optional in CI.
- **Audit executor.** When `runAuditType` stops emitting a stub,
  the `smoke 3: audit --type stub message references v0.5` test's
  negative assertion (`.not.toContain("ships in v0.3")`) and its
  positive assertion (`.toContain("v0.5")`) both need to flip:
  positive case becomes "executor produced N findings", negative
  becomes "no stub banner present".
- **`cadence upgrade`.** Integration spec needs to exercise the
  3-way merge using the `contentHash` recorded by `cadence add`.
  The v0.3.1 conversion's `smoke 5` test already pins the hash
  format so upgrade has a stable contract to read from.

### Flakiness observed

None across multiple runs. Wall time is consistent:

- Unit suite: ~0.5s.
- Integration suite (23 tests, ~5 spawns each on average): ~1.0s.
- Combined `npm test`: ~1.1s.

Each subprocess spawn is ~30-60ms cold. The slowest single test is
`smoke 10: doctor on a freshly-initialized repo passes all checks` at
~200ms (two spawns: init + doctor). All well under the 30s timeout.

### `globalSetup` gotcha

If a developer runs `npx vitest run tests/integration/SOME-TEST.ts`
with a freshly-cleaned `dist/`, the globalSetup will rebuild before
the spec runs. That's correct — but it means a one-test run isn't
the ~50ms developers might expect; the first run is ~1-2s while
tsc builds. Subsequent runs reuse the incremental build cache.

If `dist/` ends up corrupted, `npm run clean && npm run build`
restores it; the globalSetup will then proceed normally.

### What the cleanup-pass handoff's "next agent" note got right

The cleanup handoff said:

> Cadence has no equivalent integration harness yet — its tests are
> all unit-scoped, exercising the programmatic API from `src/index.ts`.
> When the conversion lands a CLI-spawn integration layer for cadence
> too, the new `audit --list` catalog branch deserves an integration
> smoke check.

The catalog branch IS covered by `smoke 2: audit --list enumerates
scaffolded audits + bundled catalog` and its `--json` companion. So
that note is fully discharged.

---

## Versions installed (forensic record)

No new dependencies were added during this pass. The integration
harness uses only Node stdlib.

### Cadence (post-conversion)

| Package                | Installed | Source              |
| ---------------------- | --------- | ------------------- |
| typescript             | 6.0.3     | dev dep, unchanged  |
| vitest                 | 4.1.6     | dev dep, unchanged  |
| commander              | 12.1.0    | prod dep, unchanged |
| kleur                  | 4.1.5     | prod dep, unchanged |
| @inquirer/prompts      | 7.10.1    | prod dep, unchanged |
| @types/node            | 22.19.19  | dev dep, unchanged  |
| @typescript-eslint/eslint-plugin | 7.18.0 | dev dep, unchanged |
| @typescript-eslint/parser | 7.18.0 | dev dep, unchanged  |
| eslint                 | 8.57.1    | dev dep, unchanged  |
| prettier               | 3.x       | dev dep, unchanged  |
| rimraf                 | 5.x       | dev dep, unchanged  |

`package.json` version is unchanged (still `0.3.0`). v0.3.1 is the
*milestone label* here, not a release; bumping the package.json
version is a release-management call left for the next pass.

`cadence --version` → `0.3.0` (unchanged).

### Stdlib modules used by the integration harness

- `node:child_process` (spawnSync)
- `node:fs` (mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync)
- `node:os` (tmpdir)
- `node:path` (join, resolve, dirname)
- `node:url` (fileURLToPath)

All pre-existing in the runtime; no install needed.

---

## Acceptance criteria status

| # | Criterion | Status |
| - | --------- | ------ |
| 1 | `tests/integration/` directory exists with at least 5 spec files (init, audit, add, knowledge, doctor) | **met** |
| 2 | ≥12 new `it()` test cases across the integration suite, one per smoke step (some may consolidate, e.g. 8+9 in `knowledge.test.ts`) | **met** (23 tests across 5 files; every smoke step has at least one dedicated test, several have multiple) |
| 3 | Integration tests pass under `vitest run` | **met** (23/23 pass; 108/108 in the combined suite) |
| 4 | `npm test` runs both unit AND integration tests | **met** (vitest config's include pattern picks up both directories; 15 files / 108 tests in one run) |
| 5 | CI workflow at `.github/workflows/ci.yml` includes integration tests in the test step | **met** (new file; `npm test` step runs both layers; matrix on node 20 + 22) |
| 6 | Pre-conversion total was 85; post-conversion total ≥97 | **met** (85 → 108) |
| 7 | README has a "Testing" section explaining unit vs integration layers + how to run each | **met** (under `## Development`; table maps layer → location → coverage → command) |
| 8 | All gates green: `tsc -b`, `lint`, `vitest run`, `build` | **met** (all four clean on the final commit) |
| 9 | No regressions: existing 85 unit tests still pass unchanged | **met** (85/85 unit pass via `npm run test:unit`; no unit test files modified during this pass) |

---

*End of integration-conversion HANDOFF.*
