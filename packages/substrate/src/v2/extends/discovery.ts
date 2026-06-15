/**
 * Substrate v3 — extends-aware discovery wrappers (NE-11).
 *
 * These wrap the existing v2 discoverers (`discoverWorkflows`,
 * `discoverHooks`, `discoverDocChecks`) to walk each layer in the
 * resolved `extends` chain and merge results with the locked-in
 * collision policy ("later wins"; repo-local is always last).
 *
 * Plan §2.2 prescribes the wrapper shape: existing single-root
 * discoverers stay untouched; v3 callers opt into the merged variant
 * via these functions when the consumer config declares `extends`.
 *
 * Hot path: when the consumer has no `extends` field, the chain
 * collapses to a single layer (repo-local) and the merged variant
 * delegates straight through to the v2 discoverer with zero overhead.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  discoverWorkflows,
  type DiscoveryResult,
  type InvalidManifest,
} from "../discoverer.js";
import {
  discoverHooks,
  type HookDescriptor,
  type HookDiscoveryResult,
  type InvalidHookManifest,
} from "../hooks.js";
import {
  discoverDocChecks,
  type DocCheckDescriptor,
  type DocCheckDiscoveryResult,
  type InvalidDocCheckManifest,
} from "../doc-checks.js";
import type { WorkflowDescriptor } from "../types.js";
import {
  mergeWithCollisionRecords,
  resolveExtendsChain,
  type CollisionRecord,
  type ResolvedExtendsChain,
  type ResolvedSource,
  type ResolveExtendsOptions,
} from "./resolver.js";

/**
 * Provenance tag attached to every merged entry. `source` is either the
 * original `extends[].source` URL or `"repo-local"`. `manifestPath` is
 * the absolute path the entry was read from.
 */
export interface Provenance {
  source: string;
  manifestPath: string;
}

export interface MergedWorkflow {
  descriptor: WorkflowDescriptor;
  provenance: Provenance;
}

export interface MergedHook {
  descriptor: HookDescriptor;
  provenance: Provenance;
}

export interface MergedDocCheck {
  descriptor: DocCheckDescriptor;
  provenance: Provenance;
}

export interface MergedDiscoveryResult<T> {
  /**
   * Final merged registry, with collisions resolved per the "later wins"
   * policy. Sorted deterministically.
   */
  entries: T[];
  /** Collisions encountered (one entry per same-id collision). */
  collisions: CollisionRecord[];
  /** Invalid manifests from each layer (kept separate from `entries`). */
  invalid: Array<{ source: string; problem: InvalidManifest | InvalidHookManifest | InvalidDocCheckManifest }>;
  /** The resolved `extends` chain (for diagnostics + CLI `extends list`). */
  chain: ResolvedExtendsChain;
}

/**
 * Resolve + walk each layer for workflows; merge with "later wins"
 * semantics. Repo-local is always the last layer so a same-id workflow
 * declared in the consumer's `substrate/workflows/` overrides every
 * extends source.
 */
export function discoverWorkflowsAcrossExtends(
  options: ResolveExtendsOptions = {},
): MergedDiscoveryResult<MergedWorkflow> {
  const chain = resolveExtendsChain(options);
  const groups: Array<{ source: string; entries: MergedWorkflow[] }> = [];
  const invalid: MergedDiscoveryResult<MergedWorkflow>["invalid"] = [];

  for (const layer of chain.layers) {
    if (!layerHasSubstrateDir(layer)) {
      groups.push({ source: layer.source, entries: [] });
      continue;
    }
    const sub: DiscoveryResult = discoverWorkflows({ cwd: layer.root });
    const entries: MergedWorkflow[] = sub.workflows.map((w) => ({
      descriptor: w,
      provenance: { source: layer.source, manifestPath: w.manifestPath },
    }));
    groups.push({ source: layer.source, entries });
    for (const inv of sub.invalidWorkflows) {
      invalid.push({ source: layer.source, problem: inv });
    }
  }

  const merged = mergeWithCollisionRecords(
    groups,
    (w) => w.descriptor.manifest.id,
    "workflow",
  );
  // Stable id-sorted output (same as the v2 discoverer).
  merged.merged.sort((a, b) =>
    a.descriptor.manifest.id.localeCompare(b.descriptor.manifest.id),
  );
  return {
    entries: merged.merged,
    collisions: merged.collisions,
    invalid,
    chain,
  };
}

/**
 * Resolve + walk each layer for hooks; merge with "later wins" semantics.
 */
export function discoverHooksAcrossExtends(
  options: ResolveExtendsOptions = {},
): MergedDiscoveryResult<MergedHook> {
  const chain = resolveExtendsChain(options);
  const groups: Array<{ source: string; entries: MergedHook[] }> = [];
  const invalid: MergedDiscoveryResult<MergedHook>["invalid"] = [];

  for (const layer of chain.layers) {
    if (!layerHasSubstrateDir(layer)) {
      groups.push({ source: layer.source, entries: [] });
      continue;
    }
    const sub: HookDiscoveryResult = discoverHooks({ cwd: layer.root });
    const entries: MergedHook[] = sub.hooks.map((h) => ({
      descriptor: h,
      provenance: { source: layer.source, manifestPath: h.manifestPath },
    }));
    groups.push({ source: layer.source, entries });
    for (const inv of sub.invalidHooks) {
      invalid.push({ source: layer.source, problem: inv });
    }
  }

  const merged = mergeWithCollisionRecords(
    groups,
    (h) => h.descriptor.manifest.id,
    "hook",
  );
  // Sort: order ascending, then id (mirrors v2 discoverHooks ordering).
  merged.merged.sort((a, b) => {
    const oa = a.descriptor.manifest.order ?? 100;
    const ob = b.descriptor.manifest.order ?? 100;
    if (oa !== ob) return oa - ob;
    return a.descriptor.manifest.id.localeCompare(b.descriptor.manifest.id);
  });
  return {
    entries: merged.merged,
    collisions: merged.collisions,
    invalid,
    chain,
  };
}

/**
 * Resolve + walk each layer for doc-checks; merge with "later wins"
 * semantics.
 */
export function discoverDocChecksAcrossExtends(
  options: ResolveExtendsOptions = {},
): MergedDiscoveryResult<MergedDocCheck> {
  const chain = resolveExtendsChain(options);
  const groups: Array<{ source: string; entries: MergedDocCheck[] }> = [];
  const invalid: MergedDiscoveryResult<MergedDocCheck>["invalid"] = [];

  for (const layer of chain.layers) {
    if (!layerHasSubstrateDir(layer)) {
      groups.push({ source: layer.source, entries: [] });
      continue;
    }
    const sub: DocCheckDiscoveryResult = discoverDocChecks({ cwd: layer.root });
    const entries: MergedDocCheck[] = sub.docChecks.map((d) => ({
      descriptor: d,
      provenance: { source: layer.source, manifestPath: d.manifestPath },
    }));
    groups.push({ source: layer.source, entries });
    for (const inv of sub.invalidDocChecks) {
      invalid.push({ source: layer.source, problem: inv });
    }
  }

  const merged = mergeWithCollisionRecords(
    groups,
    (d) => d.descriptor.manifest.id,
    "doc-check",
  );
  merged.merged.sort((a, b) =>
    a.descriptor.manifest.id.localeCompare(b.descriptor.manifest.id),
  );
  return {
    entries: merged.merged,
    collisions: merged.collisions,
    invalid,
    chain,
  };
}

/**
 * Cheap pre-check: does a given layer have a `substrate/` subdir at all?
 * Used to skip `discoverWorkflows({ cwd: layer.root })` for npm packages
 * that don't ship substrate content (so `node_modules/some-other-pkg/`
 * doesn't get a spurious "no workflows here" walk).
 */
function layerHasSubstrateDir(layer: ResolvedSource): boolean {
  return existsSync(join(layer.root, "substrate"));
}
