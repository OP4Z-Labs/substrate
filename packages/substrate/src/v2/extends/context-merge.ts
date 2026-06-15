/**
 * Substrate v3 — extends-aware standards + RULES resolution.
 *
 * Wraps the v2 context-loader's per-root standards / RULES.yaml lookup
 * with an extends-chain walk so an adopter who configures
 * `extends: [npm:@acme/substrate-shared]` sees the org's standards and
 * rules merged into their effective context — with repo-local content
 * always winning on collisions.
 *
 * The existing v2 `loadContext()` in `context-loader.ts` is untouched
 * (per plan §2.2: "existing v2 single-root discoverers stay untouched").
 * v3 callers opt into the merged variant when they know `extends` may
 * be configured.
 *
 * Collision policy (plan §2.4):
 *   - Standards: per relative path; repo-local wins; warn.
 *   - RULES.yaml: per rule id; repo-local wins; warn. Plan §2.4(b)
 *     mentions an opt-out (`extends-mode: append`) but the brief locks
 *     v3.0-alpha.1 to "repo-local wins, log warning" without an append
 *     mode — the append-mode override is a v3.1 candidate.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadRules, RulesLoadError } from "../../audit/rules.js";
import type { RuleDefinition } from "../../audit/types.js";
import type { LoadedStandard } from "../context-loader.js";
import {
  resolveExtendsChain,
  type CollisionRecord,
  type ResolveExtendsOptions,
} from "./resolver.js";

/** One standards doc found under a layer's `substrate/standards/`. */
interface LayeredStandard {
  /** Path relative to the layer's standards root (e.g. `backend/python.md`). */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** Source identifier (e.g. `npm:@acme/substrate-shared` or `"repo-local"`). */
  source: string;
}

export interface MergedStandardsResult {
  /** All standards from all layers, merged with later-wins-on-relativePath. */
  standards: LoadedStandard[];
  collisions: CollisionRecord[];
  /**
   * Per-source provenance: which source each loaded standard came from
   * (keyed by relativePath). Useful for `substrate query standards --source <id>`.
   */
  provenance: Map<string, string>;
  /** Warnings (e.g. "standards/secrets.md found in 2 layers"). */
  warnings: string[];
}

export interface MergedRulesResult {
  /** All rule rows from all layers, merged with later-wins-on-id. */
  rules: RuleDefinition[];
  collisions: CollisionRecord[];
  /** Per-rule-id provenance map. */
  provenance: Map<string, string>;
  /** Warnings (e.g. "no RULES.yaml found in chain"). */
  warnings: string[];
}

/**
 * Walk each layer's `substrate/standards/` (with the v2 fallback chain:
 * also `standards/` and `auto/standards/`) and collect every `.md` file.
 * The merged result has one entry per relativePath; the latest layer in
 * the chain wins on collision.
 */
export function discoverStandardsAcrossExtends(
  options: ResolveExtendsOptions = {},
): MergedStandardsResult {
  const chain = resolveExtendsChain(options);
  // For each layer, find its standards root (using the v2 fallback) and
  // enumerate all `.md` files.
  const slots = new Map<string, LayeredStandard[]>();
  const warnings: string[] = [];

  for (const layer of chain.layers) {
    const standardsRoot = findStandardsRoot(layer.root);
    if (!standardsRoot) continue;
    const found = enumerateMarkdown(standardsRoot);
    for (const rel of found) {
      const layered: LayeredStandard = {
        relativePath: rel,
        absolutePath: join(standardsRoot, rel),
        source: layer.source,
      };
      const list = slots.get(rel) ?? [];
      list.push(layered);
      slots.set(rel, list);
    }
  }

  const standards: LoadedStandard[] = [];
  const collisions: CollisionRecord[] = [];
  const provenance = new Map<string, string>();
  for (const [rel, layerList] of slots.entries()) {
    const winner = layerList[layerList.length - 1];
    let body: string;
    try {
      body = readFileSync(winner.absolutePath, "utf8");
    } catch (err) {
      warnings.push(
        `standards: failed to read ${winner.absolutePath}: ${(err as Error).message}`,
      );
      continue;
    }
    standards.push({
      relativePath: rel,
      absolutePath: winner.absolutePath,
      body,
    });
    provenance.set(rel, winner.source);
    if (layerList.length > 1) {
      collisions.push({
        class: "standard",
        key: rel,
        winner: winner.source,
        overridden: layerList.slice(0, -1).map((l) => l.source),
      });
    }
  }
  standards.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { standards, collisions, provenance, warnings };
}

/**
 * Walk each layer's RULES.yaml (substrate/RULES.yaml then auto/RULES.yaml)
 * and merge the rule rows. Per plan §2.4(b), default policy is
 * repo-local-wins on rule id with a warning logged for collisions.
 */
export function discoverRulesAcrossExtends(
  options: ResolveExtendsOptions = {},
): MergedRulesResult {
  const chain = resolveExtendsChain(options);
  const slots = new Map<string, Array<{ rule: RuleDefinition; source: string }>>();
  const warnings: string[] = [];

  for (const layer of chain.layers) {
    const rulesPath = findRulesFile(layer.root);
    if (!rulesPath) continue;
    let loaded;
    try {
      loaded = loadRules(rulesPath);
    } catch (err) {
      if (err instanceof RulesLoadError) {
        warnings.push(
          `extends layer '${layer.source}': RULES.yaml load error: ${err.message}`,
        );
        continue;
      }
      throw err;
    }
    const rules = loaded.document.rules ?? [];
    for (const rule of rules) {
      const list = slots.get(rule.id) ?? [];
      list.push({ rule, source: layer.source });
      slots.set(rule.id, list);
    }
  }

  const rules: RuleDefinition[] = [];
  const collisions: CollisionRecord[] = [];
  const provenance = new Map<string, string>();
  for (const [id, layerList] of slots.entries()) {
    const winner = layerList[layerList.length - 1];
    rules.push(winner.rule);
    provenance.set(id, winner.source);
    if (layerList.length > 1) {
      collisions.push({
        class: "rule",
        key: id,
        winner: winner.source,
        overridden: layerList.slice(0, -1).map((l) => l.source),
      });
    }
  }
  rules.sort((a, b) => a.id.localeCompare(b.id));
  return { rules, collisions, provenance, warnings };
}

/**
 * Mirror of context-loader's standards-root resolution but scoped to one
 * layer root. We intentionally don't import the private helper because
 * it expects a single repo root + a per-call override; the merge walk
 * needs to apply the same chain to every layer.
 */
function findStandardsRoot(layerRoot: string): string | null {
  const candidates = [
    join(layerRoot, "substrate", "standards"),
    join(layerRoot, "standards"),
    join(layerRoot, "auto", "standards"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        if (statSync(c).isDirectory()) return c;
      } catch {
        // Ignore stat errors; try the next candidate.
      }
    }
  }
  return null;
}

function findRulesFile(layerRoot: string): string | null {
  const candidates = [
    join(layerRoot, "substrate", "RULES.yaml"),
    join(layerRoot, "auto", "RULES.yaml"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Recursively enumerate all `.md` files under `root`. Returns paths
 * relative to `root`. Used to detect cross-layer standards collisions
 * even when the consumer's `context.standards` block doesn't list them
 * explicitly (the merge surface is full; the workflow's `context.standards`
 * just filters into it).
 */
function enumerateMarkdown(root: string): string[] {
  const out: string[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: "" }];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur.abs);
    } catch {
      continue;
    }
    for (const name of entries) {
      const childAbs = join(cur.abs, name);
      const childRel = cur.rel ? join(cur.rel, name) : name;
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push({ abs: childAbs, rel: childRel });
      } else if (st.isFile() && name.endsWith(".md")) {
        out.push(childRel);
      }
    }
  }
  out.sort();
  return out;
}
