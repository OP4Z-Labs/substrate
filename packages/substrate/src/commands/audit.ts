import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import kleur from "kleur";
import {
  applyEscalations,
  listDiffPaths,
  loadRules,
  locateRulesFile,
  readTrend,
  runAudit as runAuditExecutor,
  RulesLoadError,
  writeAuditReport,
  type AuditReport,
  type RuleDefinition,
  type Severity,
} from "../audit/index.js";
import { listFiles, readText } from "../util/fs.js";
import { parseFrontMatter } from "../util/frontmatter.js";
import { getTemplatesDir, resolveTargetRoot } from "../util/paths.js";

const INSTRUCTIONS_SUBPATH = join("auto", "instructions", "main");
const AUDIT_PREFIX = "audit-";
const MD_EXT = ".md";

export interface AuditDescriptor {
  /** Audit type, e.g. "pre-merge", "dependencies". */
  type: string;
  /** Absolute path to the instruction file. */
  path: string;
  /** Short description, pulled from the front matter or the first heading. */
  description: string;
}

export interface AuditCatalogEntry {
  /** Audit type, e.g. "backend", "security". */
  type: string;
  /** Absolute path to the template markdown in the substrate package. */
  path: string;
  /** Short description, pulled from the front matter or the first heading. */
  description: string;
  /** True if this catalog entry has already been scaffolded into the user's repo. */
  scaffolded: boolean;
}

export interface AuditListResult {
  /** Audits scaffolded into the user's repo (auto/instructions/main/). */
  enabled: AuditDescriptor[];
  /** Audit templates available to scaffold via `substrate add audit <name>`. */
  catalog: AuditCatalogEntry[];
}

export interface AuditListOptions {
  cwd?: string;
  json?: boolean;
  /** Suppress all stdout (used by tests). Ignored if `json` is set. */
  quiet?: boolean;
}

export interface AuditTypeOptions {
  cwd?: string;
  json?: boolean;
  /** Suppress all stdout (used by tests). Ignored if `json` is set. */
  quiet?: boolean;
}

/**
 * Enumerate audit instruction files and the bundled audit-template catalog.
 *
 * Two surfaces:
 *
 *   - `enabled`  : audits scaffolded into the user's repo under
 *                  `auto/instructions/main/audit-*.md`. The discovery
 *                  contract ("anything matching `audit-*.md` in this dir
 *                  is an audit") stays stable across substrate versions, so
 *                  substrate-aware tooling can rely on it now.
 *
 *   - `catalog`  : audit templates that ship with substrate under
 *                  `templates/audits/`. These are the audits a user CAN
 *                  scaffold via `substrate add audit <name>`. Each entry
 *                  carries a `scaffolded` flag so a single `--list`
 *                  output can tell you both "what's enabled" and "what
 *                  else you can pull in" — without re-reading the README.
 *
 * Design decision (2026-05-14 cleanup): default behavior shows BOTH
 * sections. Alternative considered: a `--catalog` flag toggling between
 * enabled-only (default) and catalog-only views. Rejected because the
 * smoke tester's first instinct was "show me what's available" and the
 * combined view answers that without a flag. Adding `--catalog` later as
 * a filter is non-breaking if it becomes useful.
 */
export function runAuditList(options: AuditListOptions = {}): AuditListResult {
  const root = resolveTargetRoot(options.cwd);
  const dir = join(root, INSTRUCTIONS_SUBPATH);
  const enabled = discoverAudits(dir);
  const catalog = discoverCatalog(enabled);
  const result: AuditListResult = { enabled, catalog };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (options.quiet) return result;

  if (enabled.length === 0) {
    console.log(kleur.yellow("No audits scaffolded in this repo."));
    console.log(
      kleur.dim(`  Expected: ${join(INSTRUCTIONS_SUBPATH, "audit-<type>.md")} in ${root}`),
    );
    console.log(kleur.dim("  Tip: run `substrate init` to scaffold the defaults."));
  } else {
    console.log(kleur.bold(`\nEnabled (scaffolded) — ${enabled.length}\n`));
    const widest = Math.max(...enabled.map((a) => a.type.length));
    for (const audit of enabled) {
      console.log(
        `  ${kleur.cyan(audit.type.padEnd(widest))}  ${kleur.dim(audit.description)}`,
      );
    }
    console.log("\n" + kleur.dim(`  Run: substrate audit --type <name>`));
  }

  const addable = catalog.filter((c) => !c.scaffolded);
  if (addable.length > 0) {
    console.log(kleur.bold(`\nAvailable (catalog) — ${addable.length}\n`));
    const widest = Math.max(...addable.map((c) => c.type.length));
    for (const entry of addable) {
      console.log(
        `  ${kleur.cyan(entry.type.padEnd(widest))}  ${kleur.dim(entry.description)}`,
      );
    }
    console.log("\n" + kleur.dim(`  Add: substrate add audit <name>\n`));
  } else if (enabled.length > 0) {
    // Empty trailing line keeps spacing consistent with the addable branch above.
    console.log("");
  }

  return result;
}

export interface AuditRunReport {
  type: string;
  status: "stub" | "would-run";
  instructionPath: string;
  description: string;
  /** v0.1: always 0. The detector layer (v0.3) will populate this. */
  findings: number;
}

/**
 * Load an audit instruction file and emit a stub report.
 *
 * Per the brief, v0.1 prints "would run audit X" rather than executing
 * detectors. The real runtime lives in v0.3. This stub still does the
 * useful early work: validates the instruction file exists, parses its
 * front matter, and prints a structured summary so users can verify
 * their scaffold before the runtime ships.
 */
export function runAuditType(type: string, options: AuditTypeOptions = {}): AuditRunReport {
  const root = resolveTargetRoot(options.cwd);
  const dir = join(root, INSTRUCTIONS_SUBPATH);
  const filename = `${AUDIT_PREFIX}${type}${MD_EXT}`;
  const path = join(dir, filename);

  if (!existsSync(path)) {
    const available = discoverAudits(dir).map((a) => a.type);
    const hint =
      available.length > 0
        ? `Available: ${available.join(", ")}`
        : "No audits scaffolded yet — run `substrate init`.";
    throw new Error(`Substrate: audit "${type}" not found at ${path}\n  ${hint}`);
  }

  const source = readText(path);
  const { data } = parseFrontMatter(source);
  const description = describeAudit(source, data);

  const report: AuditRunReport = {
    type,
    status: "stub",
    instructionPath: path,
    description,
    findings: 0,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report;
  }
  if (options.quiet) return report;

  console.log(kleur.bold(`\nAudit: ${type}`));
  console.log(kleur.dim(`  instruction: ${path}`));
  console.log(kleur.dim(`  description: ${description}`));
  console.log(
    "\n" +
      kleur.yellow("⚠ stub:") +
      " no detectors executed.\n" +
      kleur.dim(
        "  Substrate reads the instruction file and confirms it is well-formed.\n" +
          "  The audit executor (RULES.yaml + ripgrep / vulture / pip-audit /\n" +
          "  knip wrappers) is coming in v0.5 — for now this returns the loaded\n" +
          "  instruction stub.\n",
      ),
  );
  console.log(kleur.bold("Findings: ") + "0 (stub)\n");

  return report;
}

function discoverAudits(dir: string): AuditDescriptor[] {
  const files = listFiles(dir)
    .filter((f) => basename(f).startsWith(AUDIT_PREFIX) && f.endsWith(MD_EXT))
    .sort();
  return files.map((path) => {
    const type = basename(path).slice(AUDIT_PREFIX.length, -MD_EXT.length);
    const source = readText(path);
    const { data } = parseFrontMatter(source);
    return {
      type,
      path,
      description: describeAudit(source, data),
    };
  });
}

/**
 * Walk the bundled `templates/audits/` directory to enumerate every audit
 * the user *could* scaffold via `substrate add audit <name>`. Each entry is
 * flagged with `scaffolded: true` if the user has already pulled it into
 * `auto/instructions/main/`, so the CLI can present "enabled vs available"
 * without re-walking the user's tree.
 *
 * Errors are swallowed deliberately: if the templates dir is somehow
 * unreachable (e.g. the user's running an unbuilt checkout), we return an
 * empty catalog rather than crashing the `--list` command. The enabled
 * surface still works in that degraded mode.
 */
function discoverCatalog(enabled: AuditDescriptor[]): AuditCatalogEntry[] {
  let templatesDir: string;
  try {
    templatesDir = getTemplatesDir();
  } catch {
    return [];
  }
  const auditsDir = join(templatesDir, "audits");
  const scaffoldedTypes = new Set(enabled.map((a) => a.type));
  const files = listFiles(auditsDir)
    .filter((f) => basename(f).startsWith(AUDIT_PREFIX) && f.endsWith(MD_EXT))
    .sort();
  return files.map((path) => {
    const type = basename(path).slice(AUDIT_PREFIX.length, -MD_EXT.length);
    const source = readText(path);
    const { data } = parseFrontMatter(source);
    return {
      type,
      path,
      description: describeAudit(source, data),
      scaffolded: scaffoldedTypes.has(type),
    };
  });
}

function describeAudit(
  source: string,
  data: { description?: string; title?: string },
): string {
  if (data.description) return data.description;
  // Fall back to the first non-empty line after the front matter that
  // looks like a heading or paragraph.
  const body = stripFrontMatterAndCode(source);
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue; // Skip the H1 title itself
    if (line.startsWith(">")) continue;
    return line.length > 120 ? line.slice(0, 117) + "..." : line;
  }
  return data.title ?? "(no description)";
}

function stripFrontMatterAndCode(source: string): string {
  let body = source;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  // Remove fenced code blocks so we don't surface ```bash` as the description.
  return body.replace(/```[\s\S]*?```/g, "");
}

// =============================================================================
// v1.0 detector runtime — `substrate audit`, `--rule`, `--diff`, `--trend`.
// =============================================================================
//
// The legacy stub above (`runAuditType`) loads an instruction Markdown file
// and prints "no detectors executed". The new `runAuditExecute` actually
// runs the rule registry from `substrate/RULES.yaml`. Both surfaces stay
// available — `--type` continues to work for consumers using the v0.x
// instruction-file pattern; `audit` (no flag) and `--rule <id>` drive the
// new runtime.

export interface AuditExecuteOptions {
  cwd?: string;
  /** Override RULES.yaml path (defaults to substrate.config / discovery). */
  rulesPath?: string;
  /** Run only one rule. */
  ruleId?: string;
  /** Run only rules whose detectors touch files in the staged diff. */
  diff?: boolean;
  /** Strict load: unknown fields become errors. */
  strict?: boolean;
  /** Emit machine-readable JSON instead of human prose. */
  json?: boolean;
  /** Suppress informational stdout. */
  quiet?: boolean;
  /** Disable writing the report files (used by --diff in CI smoke). */
  noReport?: boolean;
}

export interface AuditExecuteResult {
  report: AuditReport;
  reportPaths?: { markdownPath: string; jsonPath: string; trendPath: string };
}

/**
 * Run the audit detectors against the repo.
 *
 * - With no flags, executes every rule.
 * - With `--rule <id>`, executes only that rule.
 * - With `--diff`, executes every rule but restricts ripgrep detectors
 *   to the files in the staged diff (script + composite still run).
 */
export async function runAuditExecute(
  options: AuditExecuteOptions = {},
): Promise<AuditExecuteResult> {
  const repoRoot = resolveTargetRoot(options.cwd);
  const rulesFile = locateRulesFile(repoRoot, options.rulesPath);
  if (!rulesFile) {
    throw new Error(
      "Substrate: no RULES.yaml found. Expected at substrate/RULES.yaml. " +
        'Run `substrate add standard cross-cutting/RULES` to scaffold one, ' +
        "or pass --rules-path to point at an existing file.",
    );
  }
  let loaded;
  try {
    loaded = loadRules(rulesFile, { strict: options.strict });
  } catch (err) {
    if (err instanceof RulesLoadError) {
      throw new Error(`Substrate: ${err.message}`);
    }
    throw err;
  }
  const allRules = loaded.document.rules;
  let rules: RuleDefinition[];
  let scope: string;
  let pathFilter: string[] | undefined;
  if (options.ruleId) {
    const single = allRules.find((r) => r.id === options.ruleId);
    if (!single) {
      throw new Error(
        `Substrate: rule "${options.ruleId}" not found in ${rulesFile}. ` +
          `Available IDs: ${allRules.map((r) => r.id).join(", ")}`,
      );
    }
    rules = [single];
    scope = options.ruleId;
  } else {
    rules = allRules;
    scope = options.diff ? "diff" : "all";
  }
  if (options.diff) {
    const diffPaths = listDiffPaths(repoRoot);
    if (diffPaths !== null && diffPaths.length > 0) {
      pathFilter = diffPaths;
    } else if (diffPaths !== null) {
      // Empty diff — no files changed. Short-circuit to an empty report so
      // we don't pretend all rules executed against zero paths.
      rules = [];
    }
    // diffPaths === null => not a git repo; let rules run against everything.
  }
  const report = await runAuditExecutor({
    repoRoot,
    rulesPath: rulesFile,
    rules,
    scope,
    pathFilter,
    totalRules: allRules.length,
  });

  // Apply `escalate_after` (Primitive 7). Reads historical sidecars to
  // determine first-seen dates for each finding, then bumps severity
  // per the matching rule's escalation steps. Findings now carry
  // `originalSeverity` + `severity` (= effective) so reports show
  // both. We pass the full rule set so escalations apply to any rule
  // that declares them, not just the filtered-in set.
  applyEscalations(report, { rules: allRules, repoRoot });

  // Surface load warnings as informational lines (one shot, before reports).
  if (!options.quiet && !options.json && loaded.warnings.length > 0) {
    for (const w of loaded.warnings) {
      process.stderr.write(kleur.yellow(`  warn: ${w}\n`));
    }
  }

  let reportPaths;
  if (!options.noReport) {
    reportPaths = writeAuditReport(report, { repoRoot, scope });
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ report, reportPaths }, null, 2) + "\n");
    return { report, reportPaths };
  }
  if (!options.quiet) {
    renderConsoleSummary(report, reportPaths);
  }
  return { report, reportPaths };
}

function renderConsoleSummary(
  report: AuditReport,
  reportPaths?: { markdownPath: string; jsonPath: string; trendPath: string },
): void {
  console.log("");
  console.log(kleur.bold(`Substrate audit — ${report.scope}`));
  console.log(
    kleur.dim(
      `  ${report.executedRules}/${report.totalRules} rules · ${report.totalFindings} findings · ${report.durationMs}ms`,
    ),
  );
  if (report.totalFindings > 0) {
    const sevs: Severity[] = ["critical", "high", "medium", "low"];
    const parts = sevs
      .filter((s) => report.findingsBySeverity[s] > 0)
      .map((s) => `${severityColor(s)(s)}: ${report.findingsBySeverity[s]}`);
    console.log("  " + parts.join("  "));
  }
  for (const r of report.rules) {
    if (r.skipped && r.findings.length === 0) {
      console.log(`  ${kleur.dim("○")} ${r.ruleId.padEnd(18)} ${kleur.dim(r.note ?? "skipped")}`);
      continue;
    }
    if (r.findings.length === 0) {
      console.log(`  ${kleur.green("✓")} ${r.ruleId.padEnd(18)} ${kleur.dim(r.ruleTitle)}`);
      continue;
    }
    console.log(
      `  ${severityColor(r.severity)("●")} ${r.ruleId.padEnd(18)} ${r.ruleTitle} ${kleur.dim(`(${r.findings.length} findings)`)}`,
    );
    for (const f of r.findings.slice(0, 5)) {
      const loc = f.path ? `${f.path}${f.line ? `:${f.line}` : ""}` : "(no location)";
      console.log(`      ${kleur.dim(loc)} ${f.snippet ?? f.message}`);
    }
    if (r.findings.length > 5) {
      console.log(`      ${kleur.dim(`... and ${r.findings.length - 5} more`)}`);
    }
  }
  if (reportPaths) {
    console.log("");
    console.log(kleur.dim(`  Report:  ${reportPaths.markdownPath}`));
    console.log(kleur.dim(`  JSON:    ${reportPaths.jsonPath}`));
  }
  console.log("");
}

function severityColor(sev: Severity): (s: string) => string {
  switch (sev) {
    case "critical":
      return kleur.red;
    case "high":
      return kleur.yellow;
    case "medium":
      return kleur.cyan;
    case "low":
      return kleur.dim;
  }
}

export interface AuditTrendOptions {
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
  /** Limit history to the last N entries per scope. */
  limit?: number;
}

export function runAuditTrend(options: AuditTrendOptions = {}): {
  trend: ReturnType<typeof readTrend>;
} {
  const repoRoot = resolveTargetRoot(options.cwd);
  const trend = readTrend(repoRoot);
  if (options.json) {
    process.stdout.write(JSON.stringify(trend, null, 2) + "\n");
    return { trend };
  }
  if (options.quiet) return { trend };
  if (trend.count === 0) {
    console.log(kleur.dim("No trend data yet. Run `substrate audit` to start recording history."));
    return { trend };
  }
  console.log(kleur.bold(`\nSubstrate audit trend — ${trend.count} run(s) on file\n`));
  const limit = options.limit ?? 10;
  for (const [scope, entries] of Object.entries(trend.byScope)) {
    const tail = entries.slice(-limit);
    console.log(kleur.bold(`  ${scope}`));
    for (const e of tail) {
      const sev = e.findingsBySeverity;
      const sevStr =
        sev.critical || sev.high || sev.medium || sev.low
          ? kleur.dim(
              ` (crit:${sev.critical} high:${sev.high} med:${sev.medium} low:${sev.low})`,
            )
          : "";
      console.log(
        `    ${e.ts.slice(0, 19).replace("T", " ")} · ${kleur.cyan(String(e.totalFindings))} findings${sevStr}`,
      );
    }
  }
  console.log("");
  return { trend };
}
