/**
 * Substrate v2 — Context loader.
 *
 * Given a workflow manifest + a working-tree snapshot, resolve the
 * workflow's `context.*` declarations into concrete data:
 *   - `standards`  → file paths and contents under
 *                    `<repo>/substrate/standards/<name>` (v1.0
 *                    location) or `<repo>/standards/<name>` (alt).
 *   - `memory`     → STUBBED in B1 (returns empty array). First-class
 *                    memory integration lands in B2 (see plan §6).
 *   - `rules`      → entries from RULES.yaml matching the workflow's
 *                    glob patterns (e.g. `BE-PY-*`).
 *   - `knowledge`  → STUBBED in B1 (returns empty array). Plural
 *                    knowledge sources land in B4.
 *
 * Layer: deterministic. Pure: from the same inputs, the same
 * `Context` is returned. The loader does no AI calls and no network.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTargetRoot } from "../util/paths.js";
import {
  loadRules,
  locateRulesFile,
  RulesLoadError,
} from "../audit/rules.js";
import type { RuleDefinition } from "../audit/types.js";
import type { ContextClause, WorkflowManifest } from "./types.js";

export interface WorkingTreeState {
  /** Files reported as changed (e.g. by `git diff --name-only`). */
  changedFiles?: string[];
  /** Current branch name, if known. */
  branch?: string;
  /** Latest commit message, if known. */
  commitMessage?: string;
}

export interface LoadedStandard {
  /** Path relative to the standards root (e.g. `backend/python.md`). */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  body: string;
}

export interface LoadedMemory {
  /** Memory file name without extension. */
  name: string;
  /** Frontmatter description if present. */
  description?: string;
  /** Memory body content. */
  body: string;
  /** Days since the memory was last written. */
  ageDays?: number;
  /** Memory type per frontmatter (`feedback` | `project` | etc.). */
  type?: string;
}

export interface KnowledgeBlock {
  name: string;
  body: string;
}

export interface ResolvedContext {
  standards: LoadedStandard[];
  /** Stub in B1; first-class loading in B2. */
  memories: LoadedMemory[];
  rules: RuleDefinition[];
  knowledge: KnowledgeBlock[];
  /** Warnings recorded during resolution (missing standards, etc.). */
  warnings: string[];
}

export interface LoadContextOptions {
  workflow: WorkflowManifest;
  cwd?: string;
  /** Working-tree state used for `intersect-with-changed-files`. */
  tree?: WorkingTreeState;
  /**
   * Override the path where standards live. Default: try
   * `<repo>/substrate/standards/` then `<repo>/standards/` (v1.0
   * scaffolding ships standards into one of those).
   */
  standardsRoot?: string;
  /** Override the RULES.yaml path. */
  rulesPath?: string;
}

export function loadContext(options: LoadContextOptions): ResolvedContext {
  const root = resolveTargetRoot(options.cwd);
  const warnings: string[] = [];
  const context: ContextClause = options.workflow.context ?? {};

  const standards = resolveStandards(context.standards ?? [], root, options.standardsRoot, warnings);
  const rules = resolveRules(context.rules ?? [], root, options.rulesPath, warnings);
  // TODO (B2): wire up first-class memory integration per plan §6.
  // The seam is intentional: workflows can already declare
  // `context.memory.*` in their manifest; B2 turns those declarations
  // into actual memory file reads. For B1 we return empty + a warning
  // when the workflow declared memory expectations.
  const memories: LoadedMemory[] = [];
  if (context.memory) {
    warnings.push(
      "context.memory is declared but first-class memory loading lands in B2 (Substrate v2 phase B2).",
    );
  }
  // TODO (B4): knowledge-sections resolution.
  const knowledge: KnowledgeBlock[] = [];
  if (context["knowledge-sections"] && context["knowledge-sections"].length > 0) {
    warnings.push(
      "context.knowledge-sections is declared but plural knowledge sources land in B4.",
    );
  }

  return { standards, memories, rules, knowledge, warnings };
}

function resolveStandards(
  paths: string[],
  root: string,
  override: string | undefined,
  warnings: string[],
): LoadedStandard[] {
  if (paths.length === 0) return [];
  const candidates = override
    ? [override]
    : [join(root, "substrate", "standards"), join(root, "standards"), join(root, "auto", "standards")];
  const standardsRoot = candidates.find((p) => existsSync(p));
  if (!standardsRoot) {
    warnings.push(
      `Standards root not found. Tried: ${candidates.join(", ")}. Skipping standards load.`,
    );
    return [];
  }
  const out: LoadedStandard[] = [];
  for (const rel of paths) {
    const abs = join(standardsRoot, rel);
    if (!existsSync(abs)) {
      warnings.push(`Standards doc not found: ${rel} (under ${standardsRoot})`);
      continue;
    }
    out.push({
      relativePath: rel,
      absolutePath: abs,
      body: readFileSync(abs, "utf8"),
    });
  }
  return out;
}

function resolveRules(
  patterns: string[],
  root: string,
  rulesPath: string | undefined,
  warnings: string[],
): RuleDefinition[] {
  if (patterns.length === 0) return [];
  const resolved = locateRulesFile(root, rulesPath);
  if (!resolved) {
    warnings.push(
      `RULES.yaml not found. Tried substrate/RULES.yaml and auto/RULES.yaml under ${root}.`,
    );
    return [];
  }
  let result;
  try {
    result = loadRules(resolved);
  } catch (err) {
    if (err instanceof RulesLoadError) {
      warnings.push(`RULES.yaml load error: ${err.message}`);
      return [];
    }
    throw err;
  }
  const rules = result.document.rules ?? [];
  const matchers = patterns.map((p) => globToRegex(p));
  return rules.filter((rule) => matchers.some((m) => m.test(rule.id)));
}

/**
 * Convert a simple glob (only `*` is meaningful) into a regex. We
 * intentionally keep this minimal — the user's expected vocabulary is
 * `BE-PY-*`, `FE-*-001`, exact ids. Adding full glob support invites
 * footguns (e.g. `**` semantics) that aren't needed here.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
