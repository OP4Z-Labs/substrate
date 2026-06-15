/**
 * Substrate v3 — `extends` resolver (NE-11).
 *
 * Resolves the `extends` array in a consumer's `substrate.config.json`
 * into an ordered list of substrate-content roots. Each root is a
 * filesystem directory whose `substrate/` subtree (workflows, hooks,
 * doc-checks, standards, RULES.yaml) contributes to the consumer's
 * effective registry.
 *
 * Ordering semantics (locked in plan §2.2):
 *   - Earlier entries in `extends` are the conceptual *base*.
 *   - Later entries override earlier (per-id / per-relative-path).
 *   - The repo's own `substrate/` overrides ALL extends entries.
 *
 * The resolver itself is sub-phase B; the per-kind source resolution
 * lives in `source-kinds.ts`. The resolver delegates by calling
 * `resolveSourceRoot(entry)` once per entry — keeping the merge
 * abstraction independent of how individual sources land on disk.
 *
 * Plug-in points (per plan §2.2 and CAPABILITIES-AUDIT-2026-05-16):
 *   - `src/v2/discoverer.ts:59`  workflows
 *   - `src/v2/hooks.ts:179`      hooks
 *   - `src/v2/doc-checks.ts:153` doc-checks
 *   - `src/v2/context-loader.ts:193-228` standards + RULES.yaml
 *
 * Hot-path note: a consumer with no `extends` field returns immediately
 * with a single-element chain `[{ root: repoRoot, source: "repo-local" }]`.
 * No filesystem walks beyond `resolveTargetRoot()` happen in that case —
 * v2.0 consumers see zero perf regression.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTargetRoot } from "../../util/paths.js";
import type { ExtendsSource, SubstrateConfig } from "../../util/types.js";
import {
  classifyExtendsSource,
  validateExtendsSource,
  type ExtendsKind,
} from "./config-validator.js";
import {
  resolveSourceRoot,
  type SourceResolutionError,
  type SourceResolutionResult,
} from "./source-kinds.js";

/** Identity of one resolved layer in the chain. */
export interface ResolvedSource {
  /** Absolute path to the directory containing a `substrate/` subdir. */
  root: string;
  /**
   * Identifier for diagnostics: either `"repo-local"` for the consumer's
   * own substrate/, or the original `source` string from the config.
   */
  source: string;
  /** Source kind, or `"local"` for the repo-local layer. */
  kind: ExtendsKind | "local";
  /** Index in the `extends` array (0-based); -1 for the repo-local layer. */
  order: number;
}

/** Per-source resolution failure (kept on the result so callers can render). */
export interface ResolverWarning {
  /** Original source URL string or `"repo-local"`. */
  source: string;
  message: string;
}

export interface ResolvedExtendsChain {
  /**
   * Ordered list of layers, base-first → repo-local last. The discovery
   * + context wrappers walk this in order and apply "later wins" merging
   * (so the last entry — the repo-local root — always has the final say
   * on collisions).
   */
  layers: ResolvedSource[];
  /** Errors from source-kind resolution (missing npm pkg, etc.). */
  errors: ResolverWarning[];
  /**
   * Non-fatal warnings (per-entry warnings from `validateExtendsSource`,
   * `SUBSTRATE_OFFLINE` blocking a github fetch, etc.).
   */
  warnings: ResolverWarning[];
}

export interface ResolveExtendsOptions {
  /** Override the consumer repo root (test seam). */
  cwd?: string;
  /**
   * Optional pre-parsed config. When omitted, the resolver reads
   * `substrate.config.json` from `cwd`. Tests use this seam to keep
   * fixtures small.
   */
  config?: SubstrateConfig | null;
  /**
   * Optional override for `SUBSTRATE_OFFLINE` (so unit tests can flip
   * air-gap mode without touching `process.env`).
   */
  offline?: boolean;
}

/**
 * Read `substrate.config.json` from the given root. Returns `null` if
 * the file doesn't exist or isn't parseable — the resolver treats that
 * as "no extends configured" (which collapses to the v2.0 hot path).
 */
function readConfig(root: string): SubstrateConfig | null {
  const path = join(root, "substrate.config.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SubstrateConfig;
  } catch {
    return null;
  }
}

/**
 * Resolve the `extends` chain for a consumer repo.
 *
 * Returns the ordered list of layers (base → repo-local) plus any
 * per-entry errors / warnings. The repo-local layer is ALWAYS appended
 * as the last entry, even when no `extends` is configured.
 */
export function resolveExtendsChain(
  options: ResolveExtendsOptions = {},
): ResolvedExtendsChain {
  const root = resolveTargetRoot(options.cwd);
  const config = options.config ?? readConfig(root);
  const layers: ResolvedSource[] = [];
  const errors: ResolverWarning[] = [];
  const warnings: ResolverWarning[] = [];

  // Walk extends entries first (so they land as the base).
  const entries = (config?.extends ?? []) as ExtendsSource[];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const perEntry = validateExtendsSource(entry);
    for (const w of perEntry.warnings) {
      warnings.push({ source: entry.source, message: w });
    }
    if (!perEntry.ok || !perEntry.kind) {
      errors.push({
        source: entry.source,
        message: `Unknown extends source kind: '${entry.source}'. Expected 'npm:', 'github:', or 'file:'.`,
      });
      continue;
    }

    let resolved: SourceResolutionResult;
    try {
      resolved = resolveSourceRoot(entry, {
        consumerRoot: root,
        offline: options.offline,
      });
    } catch (err) {
      errors.push({
        source: entry.source,
        message: `Unexpected error resolving '${entry.source}': ${(err as Error).message}`,
      });
      continue;
    }
    if (resolved.kind === "error") {
      errors.push({
        source: entry.source,
        message: (resolved as SourceResolutionError).message,
      });
      continue;
    }
    let layerRoot: string;
    if (resolved.kind === "warning") {
      // E.g. offline mode blocking a github fetch when a cache is missing.
      warnings.push({ source: entry.source, message: resolved.message });
      if (!resolved.root) continue;
      layerRoot = resolved.root;
    } else {
      // "ok"
      layerRoot = resolved.root;
    }
    layers.push({
      root: layerRoot,
      source: entry.source,
      kind: classifyExtendsSource(entry.source) as ExtendsKind,
      order: i,
    });
  }

  // Repo-local layer is always last (overrides everything above).
  layers.push({
    root,
    source: "repo-local",
    kind: "local",
    order: -1,
  });

  return { layers, errors, warnings };
}

/**
 * Merge collision class — for diagnostic / CLI rendering.
 */
export type CollisionClass =
  | "workflow"
  | "hook"
  | "doc-check"
  | "standard"
  | "rule";

/** One same-id / same-path collision detected during a merge. */
export interface CollisionRecord {
  class: CollisionClass;
  /** Workflow id / hook id / doc-check id / standards relpath / rule id. */
  key: string;
  /** Source that won the merge (always the latest in chain order — repo-local last). */
  winner: string;
  /** Sources that were overridden, in chain order. */
  overridden: string[];
}

/**
 * Generic merge helper: given an ordered list of `{ source, entries }`
 * groups (base first, repo-local last), produce a flat map keyed by the
 * caller-supplied id with "later wins" semantics + a list of collision
 * records.
 *
 * Used by all four discovery wrappers below.
 */
export function mergeWithCollisionRecords<T>(
  groups: Array<{ source: string; entries: T[] }>,
  keyOf: (entry: T) => string,
  collisionClass: CollisionClass,
): { merged: T[]; collisions: CollisionRecord[] } {
  type Slot = { source: string; entry: T };
  const slots = new Map<string, Slot[]>();
  for (const group of groups) {
    for (const entry of group.entries) {
      const key = keyOf(entry);
      const list = slots.get(key) ?? [];
      list.push({ source: group.source, entry });
      slots.set(key, list);
    }
  }
  const merged: T[] = [];
  const collisions: CollisionRecord[] = [];
  for (const [key, slotList] of slots.entries()) {
    const winnerSlot = slotList[slotList.length - 1];
    merged.push(winnerSlot.entry);
    if (slotList.length > 1) {
      collisions.push({
        class: collisionClass,
        key,
        winner: winnerSlot.source,
        overridden: slotList.slice(0, -1).map((s) => s.source),
      });
    }
  }
  return { merged, collisions };
}
