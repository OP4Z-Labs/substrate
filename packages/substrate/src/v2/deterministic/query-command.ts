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
 *   - rules      : filter RULES.yaml entries by id pattern
 *   - standards  : list standards docs (by path, by prefix glob)
 *   - memory     : query the active memory store (B2)
 *   - doc-checks : list / evaluate conditional doc-checks (B2)
 *   - sessions   : index session-event-log files written by `substrate run` (B4)
 *
 * `--json` is supported on all subjects for CI consumption.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { resolveTargetRoot } from "../../util/paths.js";
import {
  loadRules,
  locateRulesFile,
  RulesLoadError,
} from "../../audit/index.js";
import type { RuleDefinition } from "../../audit/index.js";
import {
  evaluateDocCheck,
  findMatchingDocChecks,
  type DocCheckFinding,
} from "../doc-checks.js";
import {
  discoverDocChecksAcrossExtends,
  discoverRulesAcrossExtends,
  discoverStandardsAcrossExtends,
} from "../extends/index.js";
import { queryMemory, type MemoryEntry } from "../memory.js";
import {
  indexSessionLogs,
  readSessionLog,
  type SessionLogIndexEntry,
} from "../orchestrator/session-log.js";

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
  /**
   * Changed-file paths to evaluate against. Returns the subset of
   * standards docs whose scope matches the file extensions / shape.
   * Mirrors the `--for-files` shape on `query doc-checks`.
   */
  forFiles?: string[];
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
  let rules: RuleDefinition[] = [];
  let rulesPath: string | null = null;

  if (options.rulesPath) {
    // Explicit --rules-path override: bypass the extends chain and load
    // the single file the caller pointed at. Matches the v2.x contract.
    rulesPath = locateRulesFile(root, options.rulesPath);
    if (!rulesPath) {
      warnings.push(
        `RULES.yaml not found at ${options.rulesPath}.`,
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
  } else {
    // v3 extends-aware path (NE-11 beta.1, bug #1). Walk every layer's
    // RULES.yaml; merge with repo-local-wins. On v2-shaped consumers
    // (no `extends`), this collapses to a single repo-local layer.
    const merged = discoverRulesAcrossExtends({ cwd: root });
    rules = merged.rules;
    for (const collision of merged.collisions) {
      warnings.push(
        `rule ${collision.key}: repo-local overrides ${collision.overridden.join(", ")}`,
      );
    }
    warnings.push(...merged.warnings);
    // Report the repo-local RULES.yaml path when present (preserves
    // existing JSON shape); otherwise null + a hint warning.
    rulesPath = locateRulesFile(root);
    if (!rulesPath && rules.length === 0) {
      warnings.push(
        `RULES.yaml not found under ${root}. Looked at substrate/RULES.yaml + auto/RULES.yaml ` +
          `and across the extends chain.`,
      );
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

/**
 * Resolve a changed-file path to one or more standards-doc relative paths
 * that apply to it. Pure heuristic: file extension / shape → scope folder
 * under `standards/`.
 *
 * The mapping is intentionally conservative — it prefers returning more
 * docs than fewer when in doubt, because consumers (agents, CI) treat
 * the result as "the docs the AI should load," and missing a doc is
 * worse than loading one extra.
 *
 * Returns a set of relative-path *prefixes* — e.g. `"backend/"` matches
 * any standards doc under `backend/`. The caller intersects these with
 * the actually-discovered standards files so prefixes that don't have
 * any docs in this consumer's tree are silently dropped.
 */
function scopesForFile(filePath: string): string[] {
  // Normalize separators + lowercase the comparison surface.
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  const ext = norm.includes(".") ? norm.slice(norm.lastIndexOf(".")) : "";
  const base = norm.includes("/") ? norm.slice(norm.lastIndexOf("/") + 1) : norm;

  const scopes = new Set<string>();

  // Backend Python.
  if (ext === ".py") {
    scopes.add("backend/");
  }
  // Frontend TS/JS — the four common React stack extensions.
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    scopes.add("frontend/");
  }
  // SQL and migrations → database docs (backend + ops).
  if (
    ext === ".sql" ||
    norm.includes("/migrations/") ||
    norm.includes("/alembic/")
  ) {
    scopes.add("backend/database.md");
    scopes.add("operations/database-ops.md");
  }
  // Dockerfile, compose, .dockerignore → docker standards.
  if (
    base === "dockerfile" ||
    base.startsWith("dockerfile.") ||
    base === ".dockerignore" ||
    /^docker-compose(\.|$)/.test(base)
  ) {
    scopes.add("infrastructure/docker.md");
  }
  // CI configs → ci-cd standards.
  if (
    norm.includes(".github/workflows/") ||
    norm.includes(".gitlab-ci") ||
    norm.includes("circleci/")
  ) {
    scopes.add("infrastructure/ci-cd.md");
  }
  // Test files (Python + TS conventions) → testing docs of the matched stack.
  const isTestFile =
    /(^|\/)test_[^/]+\.py$/.test(norm) ||
    /(^|\/)[^/]+\.test\.(ts|tsx|js|jsx)$/.test(norm) ||
    /(^|\/)[^/]+\.spec\.(ts|tsx|js|jsx)$/.test(norm) ||
    /(^|\/)tests?\//.test(norm);
  if (isTestFile) {
    if (ext === ".py") scopes.add("backend/testing.md");
    if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
      scopes.add("frontend/testing.md");
    }
  }
  // Markdown changes → cross-cutting markdown standard.
  if (ext === ".md" || ext === ".markdown") {
    scopes.add("cross-cutting/markdown-format-specification.md");
  }

  return Array.from(scopes);
}

export function runQueryStandards(
  options: QueryStandardsOptions = {},
): QueryStandardsResult {
  const root = resolveTargetRoot(options.cwd);
  const warnings: string[] = [];

  // v3 extends-aware standards discovery (NE-11 beta.1, bug #1).
  // Walks every extends layer's `substrate/standards/` tree and merges
  // by relative path with repo-local-wins. Collapses to single-root
  // behavior on v2-shaped consumers.
  const merged = discoverStandardsAcrossExtends({ cwd: root });
  let standards: Array<{ relativePath: string; absolutePath: string }> =
    merged.standards.map((s) => ({
      relativePath: s.relativePath,
      absolutePath: s.absolutePath,
    }));
  for (const collision of merged.collisions) {
    warnings.push(
      `standard ${collision.key}: repo-local overrides ${collision.overridden.join(", ")}`,
    );
  }
  warnings.push(...merged.warnings);

  // Report a representative standards root for the JSON shape — the
  // repo-local one if present, else null. Per-entry absolute paths in
  // `standards` still carry the source-of-truth.
  const repoStandardsRoot = findRepoStandardsRoot(root);
  const standardsRoot = repoStandardsRoot;
  if (!standardsRoot && standards.length === 0) {
    warnings.push(
      `Standards root not found. Tried: ${join(root, "substrate", "standards")}, ${join(root, "standards")}, ${join(root, "auto", "standards")}, and across the extends chain.`,
    );
  }

  if (options.patterns && options.patterns.length > 0) {
    const matchers = options.patterns.map(globToRegex);
    standards = standards.filter((s) =>
      matchers.some((m) => m.test(s.relativePath)),
    );
  }
  // --for-files: union of file-scope mappings, intersected with the
  // discovered standards list. A scope entry can be either a folder
  // prefix (matches any doc under it) or an exact relative path.
  if (options.forFiles && options.forFiles.length > 0) {
    const scopes = new Set<string>();
    for (const f of options.forFiles) {
      for (const s of scopesForFile(f)) scopes.add(s);
    }
    if (scopes.size === 0) {
      standards = [];
    } else {
      standards = standards.filter((entry) => {
        for (const scope of scopes) {
          // Treat trailing-slash scopes as folder prefixes; otherwise
          // require an exact relative-path match.
          if (scope.endsWith("/")) {
            if (entry.relativePath.startsWith(scope)) return true;
          } else if (entry.relativePath === scope) {
            return true;
          }
        }
        return false;
      });
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
  // v3 extends-aware doc-check discovery (NE-11 beta.1, bug #1).
  // Walks the resolved extends chain and merges by doc-check id with
  // repo-local-wins. Collapses to single-root behavior on v2-shaped
  // consumers.
  const merged = discoverDocChecksAcrossExtends({ cwd: options.cwd });
  const mergedDescriptors = merged.entries.map((e) => e.descriptor);
  const registry = mergedDescriptors.map((d) => ({
    id: d.manifest.id,
    description: d.manifest.description,
    severity: d.manifest.severity ?? "should-fix",
    manifestPath: d.manifestPath,
  }));
  const warnings: string[] = [];
  for (const invalid of merged.invalid) {
    const problem = invalid.problem as { manifestPath: string; errors: Array<{ message: string }> };
    warnings.push(
      `invalid doc-check at ${problem.manifestPath} (${invalid.source}): ${problem.errors.map((e) => e.message).join("; ")}`,
    );
  }
  for (const collision of merged.collisions) {
    warnings.push(
      `doc-check ${collision.key}: repo-local overrides ${collision.overridden.join(", ")}`,
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
    const matching = findMatchingDocChecks(mergedDescriptors, context);
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

  // Repo-local doc-checks-dir for the human-mode "Looked under: ..." hint.
  // Per-layer paths are encoded in each registry entry's manifestPath.
  const repoLocalDocChecksDir = join(
    resolveTargetRoot(options.cwd),
    "substrate",
    "doc-checks",
  );

  if (registry.length === 0) {
    console.log(kleur.yellow("No doc-checks discovered."));
    console.log(
      kleur.dim(`  Looked under: ${repoLocalDocChecksDir} + extends chain`),
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

export interface QuerySessionsOptions {
  /** Filter to one workflow id (matches the discriminant in the filename). */
  workflowId?: string;
  /** Most-recent N entries (newest first). Default unlimited. */
  limit?: number;
  /**
   * When true, include each entry's parsed event list. False (default)
   * returns the index entries only — the most common CI use case.
   */
  includeEvents?: boolean;
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface QuerySessionsResultEntry extends SessionLogIndexEntry {
  /** Event count is always cheap to compute; we surface it on every entry. */
  eventCount: number;
  /** Populated only when `includeEvents` is set. */
  events?: ReturnType<typeof readSessionLog>["events"];
  /** Read warnings (malformed lines etc.). */
  warnings: string[];
}

export interface QuerySessionsResult {
  entries: QuerySessionsResultEntry[];
  sessionsDir: string;
  warnings: string[];
}

/**
 * `substrate query sessions` — index session-event-log files written
 * by `substrate run`. Sorted newest first (descending mtime), optionally
 * filtered to one workflow id and / or capped by `limit`.
 *
 * Deterministic (no AI, no network). The underlying primitives
 * (`indexSessionLogs`, `readSessionLog`) live in the orchestrator layer
 * because that's where they're emitted; this wrapper is a thin CLI
 * surface so CI scripts can list recent runs without hand-rolling
 * directory walks.
 */
export function runQuerySessions(
  options: QuerySessionsOptions = {},
): QuerySessionsResult {
  const root = resolveTargetRoot(options.cwd);
  const sessionsDir = join(root, "substrate", "sessions");
  const indexed = indexSessionLogs({ cwd: root, workflowId: options.workflowId });
  // indexSessionLogs returns ascending; we want newest first.
  const newestFirst = [...indexed].reverse();
  const limited =
    typeof options.limit === "number" && options.limit > 0
      ? newestFirst.slice(0, options.limit)
      : newestFirst;

  const entries: QuerySessionsResultEntry[] = limited.map((idx) => {
    const read = readSessionLog(idx.path);
    return {
      ...idx,
      eventCount: read.events.length,
      events: options.includeEvents ? read.events : undefined,
      warnings: read.warnings,
    };
  });
  const result: QuerySessionsResult = {
    entries,
    sessionsDir,
    warnings: [],
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (options.quiet) return result;

  if (entries.length === 0) {
    console.log(
      kleur.yellow(
        options.workflowId
          ? `No session logs for workflow "${options.workflowId}" under ${sessionsDir}.`
          : `No session logs found under ${sessionsDir}.`,
      ),
    );
    return result;
  }

  console.log(
    kleur.dim(
      `Sessions: ${sessionsDir}${options.workflowId ? ` (workflow=${options.workflowId})` : ""}`,
    ),
  );
  for (const entry of entries) {
    const when = new Date(entry.mtimeMs).toISOString();
    const fname = entry.path.split(/[\\/]/).pop() ?? entry.path;
    console.log(
      `  ${kleur.cyan(fname)} ${kleur.dim(`(${entry.eventCount} events, ${when})`)}`,
    );
  }
  return result;
}

// --- helpers ---------------------------------------------------------------

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Locate the repo-local `substrate/standards/` directory (or its v1.0
 * fallback positions). Returns null when none exist. Per-layer
 * resolution for extends sources is handled inside
 * `discoverStandardsAcrossExtends`.
 */
function findRepoStandardsRoot(root: string): string | null {
  const candidates = [
    join(root, "substrate", "standards"),
    join(root, "standards"),
    join(root, "auto", "standards"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
