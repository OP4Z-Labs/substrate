# Substrate — programmatic API

Substrate is primarily a CLI. The same operations are also exported as
functions, so you can drive substrate from a Node script without
spawning a subprocess.

## Quickstart

```ts
import {
  runInit,
  runAuditExecute,
  runAuditTrend,
  runUpgrade,
  SUBSTRATE_VERSION,
} from "substrate";

console.log(`substrate v${SUBSTRATE_VERSION}`);

await runInit({
  projectName: "my-app",
  shortCode: "MA",
  stacks: ["typescript"],
  bridges: ["claude"],
  quiet: true,
});

const { report } = await runAuditExecute({
  cwd: process.cwd(),
  json: false,
  noReport: false,
});
console.log(`audit found ${report.totalFindings} findings`);
```

## Exported surface

```ts
// Commands
import {
  runInit,            // scaffold auto/, config, bridges
  runCreate,          // scaffold a package/service
  runAuditList,       // enumerate audit instruction files
  runAuditType,       // (legacy) load an instruction stub
  runAuditExecute,    // run the detector runtime
  runAuditTrend,      // read substrate/audits/_trend.jsonl
  runDoctor,          // diagnose installation health
  runKnowledgeRefresh,// regenerate auto/docs/KNOWLEDGE.md
  runKnowledgeShow,   // print KNOWLEDGE.md
  runUpgrade,         // three-way merge upgrade
} from "substrate";

// Audit subsystem
import {
  runAudit,           // low-level run against a rules array
  loadRules,          // parse RULES.yaml
  locateRulesFile,    // discover RULES.yaml in a repo
  writeAuditReport,   // emit report files
  renderMarkdownReport, // pure markdown serialization
  readTrend,          // read the trend journal
  RulesLoadError,     // typed error thrown by loadRules
} from "substrate";

// Types
import type {
  SubstrateConfig,
  SubstrateManifest,
  ManifestEntry,
  AuditReport,
  RuleDefinition,
  RuleResult,
  Finding,
  Detector,
  RulesYamlDocument,
  Severity,
} from "substrate";
```

## When to prefer the programmatic API

- **Embedding substrate into another tool.** A build system that runs
  audits as part of its pipeline; an editor extension that surfaces
  rule violations inline.
- **Testing.** Substrate-using projects can write tests that exercise
  substrate functions directly without subprocess overhead.
- **Custom report rendering.** Call `runAudit()` to get the
  structured report, then render it your own way instead of
  substrate's default Markdown / JSON.

## When to prefer the CLI

- **Interactive use.** The CLI's prompts, color output, and
  short-flag UX are tuned for humans.
- **CI integration.** The GitHub Action wraps the CLI; the CLI is the
  contract there.
- **One-shot operations.** The cost of spawning a Node process is
  negligible for one audit.

## Stability guarantees

The exported surface is the **v1.0 public API**. Within the v1.x line:

- Adding new exports is non-breaking.
- Adding new optional fields to existing types is non-breaking.
- Adding new variants to discriminated unions (`Detector["type"]`,
  `Severity`) is non-breaking IF callers handle the unknown case
  conservatively.
- Renames, removed exports, removed fields, or changed parameter
  types are breaking — they wait for v2.

If you need a stable structural contract for cross-language tooling,
use the JSON sidecar that `substrate audit` writes (schema documented in
`docs/audit-runtime.md`).

## Example: custom audit reporter

```ts
import {
  loadRules,
  locateRulesFile,
  runAudit,
  RulesLoadError,
} from "substrate";

async function customAudit(repoRoot: string): Promise<void> {
  const rulesPath = locateRulesFile(repoRoot);
  if (!rulesPath) {
    throw new Error("no RULES.yaml found");
  }
  let loaded;
  try {
    loaded = loadRules(rulesPath, { strict: true });
  } catch (err) {
    if (err instanceof RulesLoadError) {
      console.error("invalid RULES.yaml:", err.message);
      return;
    }
    throw err;
  }

  const report = await runAudit({
    repoRoot,
    rulesPath,
    rules: loaded.document.rules,
    scope: "custom",
    totalRules: loaded.document.rules.length,
  });

  // Custom rendering: only show critical + high.
  for (const r of report.rules) {
    if (r.findings.length === 0) continue;
    if (r.severity !== "critical" && r.severity !== "high") continue;
    console.log(`${r.severity.toUpperCase()} ${r.ruleId}: ${r.ruleTitle}`);
    for (const f of r.findings) {
      console.log(`  ${f.path}:${f.line}  ${f.snippet}`);
    }
  }
}
```

## Error handling

Most functions throw on failure. Substrate's own errors are subclasses
of `Error`:

- `RulesLoadError` — RULES.yaml parse / validation failures.
- (Other typed errors are exported from their respective subsystems.)

Generic `Error` is also raised for "not found in this repo"-style
conditions (no RULES.yaml, no manifest). Match the message or the
class name as appropriate.

## Concurrency

Substrate operations are mostly synchronous reads + writes. The few
async paths (`runAuditExecute`, `runAudit`, `runUpgrade`,
`runMcpServe`) are async functions.

Concurrent calls to operations that mutate the same substrate-managed
files (`auto/.substrate-manifest.json`, audit reports) are not safe in
the same process. Sequential calls or per-repo-root isolation are.

## See also

- [docs/audit-runtime.md](audit-runtime.md) — detector contract.
- [docs/config-schema-v1.md](config-schema-v1.md) — substrate.config shape.
- [docs/telemetry-transparency.md](telemetry-transparency.md) — what
  substrate collects when telemetry is on.
