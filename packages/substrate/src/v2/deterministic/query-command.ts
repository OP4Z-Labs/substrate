/**
 * `substrate query <subject>` — deterministic context inspection.
 *
 * Layer: deterministic. Pure read/filter operations over the same
 * stores the Context loader uses. Useful for:
 *   - CI scripts that want "the rules that apply to this PR"
 *   - Workflow authors debugging `context.*` declarations
 *   - Humans exploring "what would Substrate load if I ran X"
 *
 * Subjects:
 *   - rules     : filter RULES.yaml entries by id pattern
 *   - standards : list standards docs (by path, by prefix glob)
 *   - memory    : STUBBED in B1 — first-class memory lands in B2
 *
 * `--json` is supported on all subjects for CI consumption.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import kleur from "kleur";
import { resolveTargetRoot } from "../../util/paths.js";
import {
  loadRules,
  locateRulesFile,
  RulesLoadError,
} from "../../audit/index.js";
import type { RuleDefinition } from "../../audit/index.js";
import {
  discoverDocChecks,
  evaluateDocCheck,
  findMatchingDocChecks,
  type DocCheckFinding,
} from "../doc-checks.js";
import { queryMemory, type MemoryEntry } from "../memory.js";

export interface QueryRulesOptions {
  /** Glob patterns to match against rule ids (e.g. `BE-PY-*`). Default: all. */
  byPrefix?: string[];
  cwd?: string;
  rulesPath?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface QueryStandardsOptions {
  /** Patterns to match standards relative paths (e.g. `backend/*.md`). */
  patterns?: string[];
  /** When set, the standards root is resolved against this base. */
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface QueryMemoryOptions {
  types?: string[];
  scope?: string;
  tags?: string[];
  forFiles?: string[];
  /** Override the active memory store path (highest precedence; see plan §6.1). */
  memoryPath?: string;
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface QueryRulesResult {
  rules: RuleDefinition[];
  rulesPath: string | null;
  warnings: string[];
}

export function runQueryRules(options: QueryRulesOptions = {}): QueryRulesResult {
  const root = resolveTargetRoot(options.cwd);
  const warnings: string[] = [];
  const rulesPath = locateRulesFile(root, options.rulesPath);
  let rules: RuleDefinition[] = [];
  if (!rulesPath) {
    warnings.push(
      `RULES.yaml not found under ${root}. Looked at substrate/RULES.yaml + auto/RULES.yaml.`,
    );
  } else {
    try {
      const result = loadRules(rulesPath);
      rules = result.document.rules ?? [];
      warnings.push(...result.warnings);
    } catch (err) {
      if (err instanceof RulesLoadError) {
        warnings.push(err.message);
      } else {
        throw err;
      }
    }
  }

  const patterns = options.byPrefix ?? [];
  if (patterns.length > 0) {
    const matchers = patterns.map(globToRegex);
    rules = rules.filter((r) => matchers.some((m) => m.test(r.id)));
  }

  const out: QueryRulesResult = { rules, rulesPath, warnings };

  if (options.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else if (!options.quiet) {
    if (rules.length === 0) {
      console.log(kleur.yellow("No matching rules."));
      for (const w of warnings) console.log(kleur.dim(`  ${w}`));
    } else {
      for (const rule of rules) {
        const sev = (rule.severity ?? "medium").padEnd(8);
        console.log(`  ${kleur.cyan(rule.id)} ${kleur.dim(sev)} ${rule.title ?? ""}`);
      }
    }
  }
  return out;
}

export interface QueryStandardsResult {
  standards: Array<{ relativePath: string; absolutePath: string }>;
  standardsRoot: string | null;
  warnings: string[];
}

export function runQueryStandards(
  options: QueryStandardsOptions = {},
): QueryStandardsResult {
  const root = resolveTargetRoot(options.cwd);
  const warnings: string[] = [];
  const candidates = [
    join(root, "substrate", "standards"),
    join(root, "standards"),
    join(root, "auto", "standards"),
  ];
  const standardsRoot = candidates.find((p) => existsSync(p)) ?? null;
  let standards: Array<{ relativePath: string; absolutePath: string }> = [];
  if (!standardsRoot) {
    warnings.push(`Standards root not found. Tried: ${candidates.join(", ")}`);
  } else {
    const files = walkMarkdown(standardsRoot);
    standards = files.map((abs) => ({
      relativePath: relative(standardsRoot, abs),
      absolutePath: abs,
    }));
    if (options.patterns && options.patterns.length > 0) {
      const matchers = options.patterns.map(globToRegex);
      standards = standards.filter((s) =>
        matchers.some((m) => m.test(s.relativePath)),
      );
    }
  }

  const result: QueryStandardsResult = { standards, standardsRoot, warnings };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!options.quiet) {
    if (standards.length === 0) {
      console.log(kleur.yellow("No matching standards docs."));
      for (const w of warnings) console.log(kleur.dim(`  ${w}`));
    } else {
      for (const s of standards) {
        console.log(`  ${kleur.cyan(s.relativePath)}`);
      }
    }
  }
  return result;
}

export interface QueryMemoryResult {
  memories: MemoryEntry[];
  /** Resolved memory directory (null when no store was found). */
  memoryPath: string | null;
  /** Provenance — which discovery rule populated `memoryPath`. */
  source: "flag" | "env" | "config" | "claude-code" | "none";
  warnings: string[];
}

/**
 * Memory query — first-class in B2.
 *
 * Discovers the active memory store via the precedence order in plan
 * §6.1 (flag → env → substrate.config.json → Claude Code default →
 * none). Reads + filters memories per the query. Returns memories
 * sorted by recency (most recent first).
 */
export function runQueryMemory(
  options: QueryMemoryOptions = {},
): QueryMemoryResult {
  const queryResult = queryMemory({
    types: options.types,
    scope: options.scope,
    tags: options.tags,
    intersectWithFiles: options.forFiles,
    memoryPath: options.memoryPath,
    cwd: options.cwd,
  });

  const result: QueryMemoryResult = {
    memories: queryResult.memories,
    memoryPath: queryResult.memoryPath,
    source: queryResult.source,
    warnings: queryResult.warnings,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!options.quiet) {
    if (result.memories.length === 0) {
      console.log(
        kleur.yellow(
          `No matching memories (source: ${result.source}${result.memoryPath ? `, path: ${result.memoryPath}` : ""}).`,
        ),
      );
      for (const w of result.warnings) console.log(kleur.dim(`  ${w}`));
    } else {
      console.log(
        kleur.dim(
          `Memory store: ${result.memoryPath} (source: ${result.source})`,
        ),
      );
      for (const m of result.memories) {
        const age =
          typeof m.ageDays === "number"
            ? kleur.dim(` (${m.ageDays}d ago)`)
            : "";
        console.log(`  ${kleur.cyan(m.name)}${age} ${m.description ?? ""}`);
      }
    }
  }
  return result;
}

export interface QueryDocChecksOptions {
  forFiles?: string[];
  commitMessage?: string;
  branch?: string;
  changelogTouched?: boolean;
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface QueryDocChecksResult {
  /** All discovered doc-checks in registry order. */
  registry: Array<{
    id: string;
    description?: string;
    severity: string;
    manifestPath: string;
  }>;
  /** Findings for checks that matched the context. */
  findings: DocCheckFinding[];
  warnings: string[];
}

/**
 * Walk the doc-check registry and (optionally) evaluate it against a
 * working-tree context. When `forFiles` is omitted, returns the
 * registry listing only — no findings.
 *
 * `changelogTouched` is a convenience: when true, "CHANGELOG.md" is
 * prepended to the changed-files list so checks of the form
 * "if (feat|fix) then require CHANGELOG.md" are satisfied without
 * the caller having to know which exact filename to inject.
 */
export function runQueryDocChecks(
  options: QueryDocChecksOptions = {},
): QueryDocChecksResult {
  const discovery = discoverDocChecks({ cwd: options.cwd });
  const registry = discovery.docChecks.map((d) => ({
    id: d.manifest.id,
    description: d.manifest.description,
    severity: d.manifest.severity ?? "should-fix",
    manifestPath: d.manifestPath,
  }));
  const warnings: string[] = [];
  for (const invalid of discovery.invalidDocChecks) {
    warnings.push(
      `invalid doc-check at ${invalid.manifestPath}: ${invalid.errors.map((e) => e.message).join("; ")}`,
    );
  }
  const findings: DocCheckFinding[] = [];

  if (options.forFiles && options.forFiles.length > 0) {
    const changedFiles = [...options.forFiles];
    if (options.changelogTouched) changedFiles.push("CHANGELOG.md");
    const context = {
      changedFiles,
      commitMessage: options.commitMessage,
      branch: options.branch,
    };
    const matching = findMatchingDocChecks(discovery.docChecks, context);
    for (const m of matching) {
      findings.push(evaluateDocCheck(m, context));
    }
  }

  const result: QueryDocChecksResult = { registry, findings, warnings };
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (options.quiet) return result;

  if (registry.length === 0) {
    console.log(kleur.yellow("No doc-checks discovered."));
    console.log(
      kleur.dim(`  Looked under: ${discovery.docChecksDir}`),
    );
    return result;
  }

  if (!options.forFiles || options.forFiles.length === 0) {
    console.log(kleur.bold(`Doc-checks (${registry.length}):`));
    for (const entry of registry) {
      console.log(
        `  ${kleur.cyan(entry.id)} ${kleur.dim(`[${entry.severity}]`)} ${entry.description ?? ""}`,
      );
    }
    for (const w of warnings) console.log(kleur.yellow(`  ! ${w}`));
    return result;
  }

  if (findings.length === 0) {
    console.log(
      kleur.green(
        `✓ ${registry.length} doc-check(s) registered; none fired for the given files.`,
      ),
    );
  } else {
    console.log(
      kleur.yellow(`${findings.length} doc-check(s) fired:`),
    );
    for (const f of findings) {
      console.log(
        `  ${kleur.cyan(f.id)} ${kleur.dim(`[${f.severity}]`)}: ${f.prompt}`,
      );
      if (f.missing) {
        console.log(
          kleur.dim(`    expected updated: ${f.missing.join(", ")}`),
        );
      }
    }
  }
  for (const w of warnings) console.log(kleur.yellow(`  ! ${w}`));
  return result;
}

// --- helpers ---------------------------------------------------------------

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function walkMarkdown(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}
