# Cadence audit runtime

The `cadence audit` command runs the **detector runtime** against a
`RULES.yaml` registry. This document is the contract for rule authors,
detector implementers, and external tooling that consumes the report
format.

> **Status:** v1.0 — schema frozen. Additive changes (new detector
> types, new fields with safe defaults) are minor-version-compatible.
> Removals or renames are major bumps.

---

## TL;DR

```bash
cadence audit                       # run every rule in cadence/RULES.yaml
cadence audit --rule BE-API-001     # run one rule by id
cadence audit --diff                # restrict ripgrep to staged-diff files
cadence audit --trend               # read the history journal
cadence audit --json --no-report    # machine-friendly stdout
cadence audit --rules-path foo.yaml # override RULES.yaml location
cadence audit --strict              # unknown YAML fields = error
```

Output artefacts (written under `cadence/audits/` by default):

- `<scope>-YYYY-MM-DD.md` — human Markdown report.
- `<scope>-latest.json`   — structured sidecar consumed by tooling.
- `_trend.jsonl`          — append-only history journal for `--trend`.

The `<scope>` is `all` for a full run, `diff` for `--diff`, or the
rule ID for `--rule <id>`.

---

## RULES.yaml shape

```yaml
meta:
  version: 1.0.0          # informational
  description: ...        # informational
rules:
  - id: SCOPE-CATEGORY-NUM
    title: Short one-line description
    severity: critical | high | medium | low
    doc: backend/api.md   # optional — links to the standards doc
    category: backend     # optional — used for report grouping
    description: ...      # multi-line free text
    tags: [...]           # optional — for filtering
    detector:
      type: ripgrep | script | composite
      # ...type-specific fields...
```

**ID convention.** Cadence does not enforce a particular ID format — it
only enforces uniqueness within a single RULES.yaml. The recommended
shape is `<SCOPE>-<CATEGORY>-<NUM>` (e.g. `BE-API-001`).

**Severity** drives report sorting and CI gating. The shipped GitHub
Action treats `error` (default) as critical+high failing the build.

**Manual rules** (no `detector:` block) load successfully but the
runtime marks them `skipped: true` in the report. Use them when human
review is the only viable enforcement.

---

## Detector types

### `ripgrep`

The most common detector — pattern-match file contents.

```yaml
detector:
  type: ripgrep
  pattern: 'TODO\(.+?\):'           # required, regex by default
  paths: [src, packages]            # optional, defaults to "."
  exclude: ['**/*.test.ts']         # optional, see default excludes below
  caseSensitive: true               # optional, default true
  fixedString: false                # optional, treat pattern as literal
  multiline: false                  # optional, span multiple lines
```

**Fast path.** When `rg` (ripgrep) is on `$PATH`, cadence shells out
via `spawnSync` (argv array, no shell interpolation). Pattern is
delivered after `--` to prevent flag injection.

**Fallback path.** When ripgrep is unavailable, cadence runs an
equivalent Node-only scan using `RegExp` and `readdirSync`. The two
paths must produce identical findings; divergence is a bug.

**Default excludes** (when `exclude:` is unset):

```
node_modules/**   .git/**         dist/**          build/**
coverage/**       .next/**        .turbo/**        __pycache__/**
.venv/**          venv/**         .pytest_cache/** *.lock
package-lock.json
```

Override `exclude:` to disable these — pass `exclude: []` for "scan
everything."

### `script`

Invoke a JS/MJS script in the consumer repo via Node `worker_threads`.

```yaml
detector:
  type: script
  path: cadence/detectors/no-large-files.mjs   # repo-relative or absolute
  export: default                              # optional, default "default"
  options:                                     # optional, passed verbatim
    maxKb: 250
  timeoutMs: 30000                             # optional, 30s default; cap 5min
```

**Contract.** The script exports a function that receives a
`DetectorContext` and returns (or resolves) an array of findings:

```js
// cadence/detectors/no-large-files.mjs
export default async function detect(ctx) {
  const findings = [];
  const entries = ctx.readdir(".");
  for (const name of entries) {
    if (!ctx.exists(name)) continue;
    const text = ctx.readFile(name);
    if (text.length > (ctx.options.maxKb ?? 100) * 1024) {
      findings.push(ctx.finding({
        message: `file is > ${ctx.options.maxKb}kb`,
        path: name,
      }));
    }
  }
  return findings;
}
```

**Sandbox.** The worker runs with:

- An empty `env` (no `process.env` access to host secrets).
- `ctx.readFile`, `ctx.readdir`, `ctx.exists` constrained to
  `repoRoot` — out-of-tree reads throw `EPERM`.
- A wall-clock timeout (default 30 s, max 5 min) enforced via
  `worker.terminate()`.

Scripts can `import` any built-in Node module (`fs`, `path`, etc.) or
any dep installed in the consumer's `node_modules`. **Cadence does not
restrict network access at v1.0** — rule authors are responsible for
not making outbound calls.

**TS scripts.** Cadence does not transpile at runtime. Ship `.js` /
`.mjs` (compiled by the consumer's own build).

### `composite`

Combine other rules' outcomes into a single verdict.

```yaml
detector:
  type: composite
  operator: all | any | none
  rules: [BE-API-001, BE-API-002]
```

- `all`  — fires when every sub-rule emitted at least one finding.
- `any`  — fires when at least one sub-rule emitted a finding.
- `none` — fires when no sub-rule emitted findings (use for "you must
  have at least one X" requirements).

Composite rules are evaluated AFTER all referenced rules complete.
Cycles or unresolved IDs result in a `note` on the rule but do not
abort the run.

---

## Report JSON schema

```ts
interface AuditReport {
  schemaVersion: 1;
  cadenceVersion: string;            // e.g. "1.0.0"
  generatedAt: string;               // ISO 8601
  repoRoot: string;                  // absolute path
  rulesPath: string;                 // absolute path to RULES.yaml
  scope: string;                     // "all" | "diff" | "<rule-id>"
  totalRules: number;                // before --rule / --diff filtering
  executedRules: number;             // after filtering
  totalFindings: number;
  findingsBySeverity: {
    critical: number; high: number; medium: number; low: number;
  };
  rules: RuleResult[];
  durationMs: number;
}

interface RuleResult {
  ruleId: string;
  ruleTitle: string;
  severity: Severity;
  detectorType: 'ripgrep' | 'script' | 'composite' | 'manual';
  findings: Finding[];
  durationMs: number;
  skipped: boolean;
  note?: string;
}

interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  path?: string;                     // repo-relative
  line?: number;                     // 1-indexed
  column?: number;                   // 1-indexed
  snippet?: string;                  // capped at ~200 chars
}
```

The `_trend.jsonl` journal contains one JSON object per audit run with
this shape (subset of the full report):

```ts
interface TrendEntry {
  ts: string;
  scope: string;
  cadenceVersion: string;
  executedRules: number;
  totalFindings: number;
  findingsBySeverity: { critical, high, medium, low };
  durationMs: number;
}
```

---

## CI integration

```yaml
- uses: BeauGoldberg/cadence@v1
  with:
    command: audit --diff
    fail-on: error          # error (default), warning, none
```

The action wrapper inspects `<scope>-latest.json` and fails the job
when `findingsBySeverity.critical > 0` (or `high > 0` if `fail-on`
includes "warning"). `fail-on: none` makes the action report-only.

---

## Migration notes

Cadence v0.x shipped RULES.yaml as a static manifest with the
`detector.type` values `manual` and `shell`. The v1.0 runtime:

- **Accepts** `manual` and `shell` for backward compatibility, but
  treats them as no-ops (the rule loads, the report marks it
  `skipped`). `shell` emits a deprecation warning when `--strict`.
- **Adds** `script` and `composite` as the recommended replacements
  for `shell` (script) and rules that previously hand-rolled "this
  AND that AND that" logic in detector chains.

To upgrade a v0.x `shell` detector to v1.0:

```yaml
# v0.x
detector:
  type: shell
  command: 'grep -L "USER " apps/*/Dockerfile'

# v1.0 — option 1: pure ripgrep
detector:
  type: ripgrep
  pattern: '^USER '
  paths: ['apps/*/Dockerfile']
  # The rule fires when the pattern is ABSENT — pair with composite.

# v1.0 — option 2: script
detector:
  type: script
  path: cadence/detectors/dockerfile-user.mjs
```

---

## Authoring checklist

- [ ] Rule has a stable, unique ID (uniqueness enforced; convention
      `SCOPE-CATEGORY-NUM`).
- [ ] Severity is one of `critical | high | medium | low`.
- [ ] If the rule is automated, it has a `detector:` block.
- [ ] If manual review only, omit `detector:` (the runtime will mark
      it skipped with a clear note).
- [ ] Pattern (ripgrep) or script (script) tested locally first.
- [ ] `doc:` field points at the owning standards doc when applicable.
- [ ] `cadence audit --rule <id> --json --no-report` produces the
      expected findings.
