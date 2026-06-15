/**
 * Substrate v3 — `substrate extends` CLI surface (NE-11 sub-phase D).
 *
 * Three subcommands:
 *
 *   - `substrate extends list [--json]` — resolves the consumer's
 *     `extends` chain and prints which layer contributed what.
 *
 *   - `substrate extends sync [--source <id>]` — re-fetches `github:`
 *     cache entries. No-op for `npm:` (npm install owns that) and
 *     `file:` (live filesystem).
 *
 *   - `substrate extends clear-cache` — wipes
 *     `substrate/.cache/extends/`.
 *
 * Layer: deterministic. No AI calls; all output is machine-renderable
 * via `--json`. Discovery + caching are reused from
 * `src/v2/extends/*.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { resolveTargetRoot } from "../../util/paths.js";
import type { ExtendsSource, SubstrateConfig } from "../../util/types.js";
import {
  clearExtendsCache,
  discoverDocChecksAcrossExtends,
  discoverHooksAcrossExtends,
  discoverRulesAcrossExtends,
  discoverStandardsAcrossExtends,
  discoverWorkflowsAcrossExtends,
  refreshGithubSource,
  resolveExtendsChain,
  resolveOffline,
} from "../extends/index.js";

interface CliCommonOptions {
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface ExtendsListOptions extends CliCommonOptions {
  /**
   * Diagnostic flag (v3.0.0-beta.1): bypass `extends-opt-out` filtering
   * so suppressed sources reappear in the listing. Useful for verifying
   * "what would the chain look like if I removed the opt-out?".
   */
  includeOptOut?: boolean;
}

export interface ExtendsListLayer {
  source: string;
  kind: "npm" | "github" | "file" | "local";
  root: string;
  counts: {
    workflows: number;
    hooks: number;
    docChecks: number;
    standards: number;
    rules: number;
  };
}

export interface ExtendsListResult {
  layers: ExtendsListLayer[];
  /** Aggregated effective registry counts after merge. */
  effective: {
    workflows: number;
    hooks: number;
    docChecks: number;
    standards: number;
    rules: number;
  };
  collisions: Array<{
    class: string;
    key: string;
    winner: string;
    overridden: string[];
  }>;
  errors: Array<{ source: string; message: string }>;
  warnings: Array<{ source: string; message: string }>;
  exitCode: number;
}

/**
 * `substrate extends list` — resolves the chain and tallies per-layer
 * contributions.
 *
 * Exit code:
 *  - 0 on success
 *  - 1 when one or more layers errored (we still print the rest)
 */
export function runExtendsList(
  options: ExtendsListOptions = {},
): ExtendsListResult {
  // Propagate `includeOptOut` (v3.0.0-beta.1) to every discovery walk
  // so the per-layer counts AND the chain layers stay consistent.
  const resolveOpts = {
    cwd: options.cwd,
    includeOptOut: options.includeOptOut,
  };
  const chain = resolveExtendsChain(resolveOpts);

  // Per-layer counts: walk each layer in isolation so we can tally
  // contributions before merging. The merge-aware discovery wrappers
  // already do this internally; we reuse them and bucket by provenance.
  const workflows = discoverWorkflowsAcrossExtends(resolveOpts);
  const hooks = discoverHooksAcrossExtends(resolveOpts);
  const docChecks = discoverDocChecksAcrossExtends(resolveOpts);
  const standards = discoverStandardsAcrossExtends(resolveOpts);
  const rules = discoverRulesAcrossExtends(resolveOpts);

  const layers: ExtendsListLayer[] = chain.layers.map((layer) => ({
    source: layer.source,
    kind: layer.kind as ExtendsListLayer["kind"],
    root: layer.root,
    counts: {
      workflows: 0,
      hooks: 0,
      docChecks: 0,
      standards: 0,
      rules: 0,
    },
  }));
  const indexBySource = new Map(layers.map((l, i) => [l.source, i] as const));

  for (const w of workflows.entries) {
    const i = indexBySource.get(w.provenance.source);
    if (i !== undefined) layers[i].counts.workflows += 1;
  }
  for (const h of hooks.entries) {
    const i = indexBySource.get(h.provenance.source);
    if (i !== undefined) layers[i].counts.hooks += 1;
  }
  for (const d of docChecks.entries) {
    const i = indexBySource.get(d.provenance.source);
    if (i !== undefined) layers[i].counts.docChecks += 1;
  }
  for (const [, source] of standards.provenance.entries()) {
    const i = indexBySource.get(source);
    if (i !== undefined) layers[i].counts.standards += 1;
  }
  for (const [, source] of rules.provenance.entries()) {
    const i = indexBySource.get(source);
    if (i !== undefined) layers[i].counts.rules += 1;
  }

  const collisions = [
    ...workflows.collisions,
    ...hooks.collisions,
    ...docChecks.collisions,
    ...standards.collisions,
    ...rules.collisions,
  ];

  const result: ExtendsListResult = {
    layers,
    effective: {
      workflows: workflows.entries.length,
      hooks: hooks.entries.length,
      docChecks: docChecks.entries.length,
      standards: standards.standards.length,
      rules: rules.rules.length,
    },
    collisions: collisions.map((c) => ({
      class: c.class,
      key: c.key,
      winner: c.winner,
      overridden: c.overridden,
    })),
    errors: chain.errors,
    warnings: chain.warnings,
    exitCode: chain.errors.length > 0 ? 1 : 0,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }

  if (!options.quiet) renderExtendsListHuman(result);
  return result;
}

function renderExtendsListHuman(result: ExtendsListResult): void {
  process.stdout.write(
    kleur.bold("Resolved extends sources (order: base → repo-local):\n\n"),
  );
  result.layers.forEach((layer, idx) => {
    const label =
      layer.source === "repo-local"
        ? kleur.green("(repo-local)")
        : kleur.cyan(layer.source);
    process.stdout.write(`[${idx + 1}] ${label}\n`);
    process.stdout.write(`    ${kleur.dim("Path:")} ${layer.root}\n`);
    const c = layer.counts;
    process.stdout.write(
      `    workflows: ${c.workflows}  hooks: ${c.hooks}  doc-checks: ${c.docChecks}  ` +
        `standards: ${c.standards}  RULES: ${c.rules} rows\n\n`,
    );
  });
  const e = result.effective;
  process.stdout.write(
    kleur.bold(
      `Effective registry: ${e.workflows} workflows · ${e.hooks} hooks · ` +
        `${e.docChecks} doc-checks · ${e.standards} standards · ${e.rules} RULES rows\n`,
    ),
  );
  if (result.collisions.length > 0) {
    process.stdout.write(
      kleur.yellow(`\nConflicts (${result.collisions.length}):\n`),
    );
    for (const c of result.collisions) {
      process.stdout.write(
        `  ${c.class} ${kleur.bold(c.key)}: ${c.winner} overrides ${c.overridden.join(", ")}\n`,
      );
    }
  }
  if (result.warnings.length > 0) {
    process.stdout.write(kleur.yellow(`\nWarnings:\n`));
    for (const w of result.warnings) {
      process.stdout.write(`  ${w.source}: ${w.message}\n`);
    }
  }
  if (result.errors.length > 0) {
    process.stdout.write(kleur.red(`\nErrors:\n`));
    for (const err of result.errors) {
      process.stdout.write(`  ${err.source}: ${err.message}\n`);
    }
  }
}

export interface ExtendsSyncOptions extends CliCommonOptions {
  source?: string;
}

export interface ExtendsSyncResult {
  refreshed: Array<{ source: string; kind: string; outcome: "ok" | "warning" | "error"; message?: string }>;
  skipped: Array<{ source: string; reason: string }>;
  exitCode: number;
}

/**
 * `substrate extends sync [--source <id>]` — refresh `github:` cache
 * entries. `npm:` and `file:` sources are skipped (with a reason).
 *
 * Exit code: 0 on full success, 1 when any source erred.
 */
export function runExtendsSync(
  options: ExtendsSyncOptions = {},
): ExtendsSyncResult {
  const root = resolveTargetRoot(options.cwd);
  const config = readConfig(root);
  const entries = config?.extends ?? [];
  const filter = options.source;
  const refreshed: ExtendsSyncResult["refreshed"] = [];
  const skipped: ExtendsSyncResult["skipped"] = [];
  const offline = resolveOffline(undefined);

  for (const entry of entries) {
    if (filter && entry.source !== filter) {
      skipped.push({ source: entry.source, reason: "filtered out by --source" });
      continue;
    }
    if (entry.source.startsWith("npm:")) {
      skipped.push({
        source: entry.source,
        reason: "npm: sources are refreshed via 'npm install'/'npm update'.",
      });
      continue;
    }
    if (entry.source.startsWith("file:")) {
      skipped.push({
        source: entry.source,
        reason: "file: sources read live from disk; no cache to refresh.",
      });
      continue;
    }
    if (entry.source.startsWith("github:")) {
      const result = refreshGithubSource(entry, {
        consumerRoot: root,
        offline,
      });
      if (result.kind === "ok") {
        refreshed.push({ source: entry.source, kind: "github", outcome: "ok" });
      } else if (result.kind === "warning") {
        refreshed.push({
          source: entry.source,
          kind: "github",
          outcome: "warning",
          message: result.message,
        });
      } else {
        refreshed.push({
          source: entry.source,
          kind: "github",
          outcome: "error",
          message: result.message,
        });
      }
      continue;
    }
    skipped.push({ source: entry.source, reason: "unrecognized source kind" });
  }

  const exitCode = refreshed.some((r) => r.outcome === "error") ? 1 : 0;
  const result: ExtendsSyncResult = { refreshed, skipped, exitCode };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }

  if (!options.quiet) renderExtendsSyncHuman(result);
  return result;
}

function renderExtendsSyncHuman(result: ExtendsSyncResult): void {
  if (result.refreshed.length === 0 && result.skipped.length === 0) {
    process.stdout.write(
      kleur.dim("No extends sources configured. Nothing to sync.\n"),
    );
    return;
  }
  for (const r of result.refreshed) {
    if (r.outcome === "ok") {
      process.stdout.write(kleur.green(`✓ ${r.source}: refreshed\n`));
    } else if (r.outcome === "warning") {
      process.stdout.write(kleur.yellow(`! ${r.source}: ${r.message}\n`));
    } else {
      process.stdout.write(kleur.red(`✗ ${r.source}: ${r.message}\n`));
    }
  }
  for (const s of result.skipped) {
    process.stdout.write(kleur.dim(`- ${s.source}: ${s.reason}\n`));
  }
}

export interface ExtendsClearCacheOptions extends CliCommonOptions {}

export interface ExtendsClearCacheResult {
  removed: boolean;
  path: string;
  exitCode: number;
}

/**
 * `substrate extends clear-cache` — wipe `substrate/.cache/extends/`.
 *
 * Always exits 0 (a no-op when the dir doesn't exist is success, not
 * a failure).
 */
export function runExtendsClearCache(
  options: ExtendsClearCacheOptions = {},
): ExtendsClearCacheResult {
  const root = resolveTargetRoot(options.cwd);
  const { removed, path } = clearExtendsCache(root);
  const result: ExtendsClearCacheResult = { removed, path, exitCode: 0 };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (!options.quiet) {
    if (removed) {
      process.stdout.write(kleur.green(`✓ Removed ${path}\n`));
    } else {
      process.stdout.write(kleur.dim(`No extends cache at ${path}; nothing to remove.\n`));
    }
  }
  return result;
}

function readConfig(root: string): SubstrateConfig | null {
  const path = join(root, "substrate.config.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SubstrateConfig;
  } catch {
    return null;
  }
}

/** Re-export type for CLI consumers / tests. */
export type { ExtendsSource };
