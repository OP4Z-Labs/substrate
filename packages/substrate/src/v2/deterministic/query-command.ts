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
  memories: never[];
  warnings: string[];
}

/**
 * Memory query — STUB in B1.
 *
 * Returns an empty list with a deferred-feature warning. First-class
 * memory integration (Claude Code memory directory bridge, frontmatter
 * extensions, query filters) lands in B2 per plan §6.
 */
export function runQueryMemory(options: QueryMemoryOptions = {}): QueryMemoryResult {
  const result: QueryMemoryResult = {
    memories: [],
    warnings: [
      "Memory queries return empty in B1. First-class memory integration (frontmatter, scope/tags, Claude Code bridge) lands in B2 — see plan §6.",
    ],
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!options.quiet) {
    console.log(kleur.yellow(result.warnings[0]));
  }
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
