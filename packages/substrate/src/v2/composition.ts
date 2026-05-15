/**
 * Substrate v2 — `composes_findings_of` runtime (Primitive 6).
 *
 * Workflows declare cross-workflow dependencies via
 * `composes_findings_of: [{ workflow, section?, require-fresh-within }]`.
 * Before the workflow runs, the orchestrator checks the freshness of
 * each declared dependency and surfaces a warning when any dep is
 * stale beyond the declared `require-fresh-within` duration.
 *
 * Layer: deterministic. Reads sidecar JSON files from
 * `substrate/audits/<workflow-id>-latest.json`, checks `generatedAt`
 * against `now()`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveTargetRoot } from "../util/paths.js";
import type { ComposedFinding, WorkflowManifest } from "./types.js";

export interface SidecarLookupOptions {
  cwd?: string;
  /** Test seam — override "now" for deterministic freshness tests. */
  now?: Date;
}

export interface SidecarRecord {
  /** The workflow id the sidecar belongs to. */
  workflowId: string;
  /** Absolute path of the sidecar file. */
  path: string;
  /** ISO timestamp when the sidecar was generated. */
  generatedAt: string;
  /** Parsed mtime in ms (used when generatedAt is missing). */
  mtimeMs: number;
  /** Whole-days age relative to `now`. */
  ageDays: number;
  /** Whole-hours age relative to `now` (for sub-day freshness). */
  ageHours: number;
  /** Parsed sidecar payload (opaque to the composition layer). */
  payload?: Record<string, unknown>;
}

export interface CompositionCheckResult {
  /** One entry per declared dependency. */
  dependencies: Array<{
    workflow: string;
    section?: string;
    requireFreshWithin?: string;
    sidecar: SidecarRecord | null;
    stale: boolean;
    reason: string;
  }>;
  /** Convenience aggregate: any dependency is stale or missing. */
  hasStale: boolean;
  /** Human-readable warnings to surface at workflow start. */
  warnings: string[];
}

/**
 * Locate the sidecar for a workflow id. Sidecar convention follows v1's
 * audit pipeline: `substrate/audits/<scope-slug>-latest.json`. We look
 * for an exact workflow-id match first, then fall back to slug
 * variants (substrate audit slugifies scopes — that pattern is the
 * dominant case in B2 because audit workflows wrap `substrate audit`).
 */
export function findLatestSidecar(
  workflowId: string,
  options: SidecarLookupOptions = {},
): SidecarRecord | null {
  const root = resolveTargetRoot(options.cwd);
  const dir = join(root, "substrate", "audits");
  if (!existsSync(dir)) return null;

  // Direct hit: <workflow-id>-latest.json
  const direct = join(dir, `${workflowId}-latest.json`);
  if (existsSync(direct)) {
    return readSidecar(workflowId, direct, options.now);
  }

  // Fallback: walk and find any `*-latest.json` whose payload's
  // `scope` matches the workflow id. Useful when audit workflows
  // delegate scope naming to the underlying detector pass.
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.endsWith("-latest.json")) continue;
    const full = join(dir, name);
    const record = readSidecar(workflowId, full, options.now);
    if (record && record.payload && record.payload.scope === workflowId) {
      return record;
    }
  }
  return null;
}

function readSidecar(
  workflowId: string,
  path: string,
  now: Date | undefined,
): SidecarRecord | null {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  let payload: Record<string, unknown> | undefined;
  let generatedAt: string | undefined;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
      const gen = (parsed as { generatedAt?: unknown }).generatedAt;
      if (typeof gen === "string") generatedAt = gen;
    }
  } catch {
    // Treat as missing payload — mtime-only freshness.
  }
  const nowMs = (now ?? new Date()).getTime();
  const generatedMs = generatedAt
    ? Date.parse(generatedAt)
    : st.mtimeMs;
  const sourceMs = Number.isNaN(generatedMs) ? st.mtimeMs : generatedMs;
  const ageMs = Math.max(0, nowMs - sourceMs);
  return {
    workflowId,
    path,
    generatedAt: generatedAt ?? new Date(st.mtimeMs).toISOString(),
    mtimeMs: st.mtimeMs,
    ageDays: Math.floor(ageMs / (1000 * 60 * 60 * 24)),
    ageHours: Math.floor(ageMs / (1000 * 60 * 60)),
    payload,
  };
}

/**
 * Parse `require-fresh-within` durations. Supported units:
 *   `1d`, `7d`, `24h`, `90m`, `3600s`. Returns the duration in
 *   milliseconds, or null when unparseable.
 */
export function parseDuration(duration: string | undefined): number | null {
  if (!duration) return null;
  const m = duration.match(/^\s*(\d+)\s*([smhdw])\s*$/);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  const unit = m[2];
  const multiplier = {
    s: 1000,
    m: 60_000,
    h: 60 * 60_000,
    d: 24 * 60 * 60_000,
    w: 7 * 24 * 60 * 60_000,
  }[unit];
  if (!multiplier) return null;
  return value * multiplier;
}

/**
 * Check a workflow's `composes_findings_of` block against the
 * filesystem sidecar registry. Returns a structured result the
 * orchestrator can surface as warnings.
 *
 * Stale-dependency semantics:
 *   - Missing sidecar  → stale=true,  reason="no sidecar found"
 *   - Sidecar present but age > require-fresh-within → stale=true,
 *     reason="N hours/days since last run (older than require-fresh-within)"
 *   - Sidecar present and require-fresh-within unset → stale=false
 *     (the workflow author explicitly opted into "any age is fine")
 *   - No `composes_findings_of` block → empty result, no warnings
 */
export function checkComposition(
  manifest: WorkflowManifest,
  options: SidecarLookupOptions = {},
): CompositionCheckResult {
  const result: CompositionCheckResult = {
    dependencies: [],
    hasStale: false,
    warnings: [],
  };
  const deps = manifest.composes_findings_of ?? [];
  if (deps.length === 0) return result;

  const now = options.now ?? new Date();
  for (const dep of deps) {
    const sidecar = findLatestSidecar(dep.workflow, {
      cwd: options.cwd,
      now,
    });
    const evaluation = evaluateDependency(dep, sidecar, now);
    result.dependencies.push(evaluation);
    if (evaluation.stale) {
      result.hasStale = true;
      result.warnings.push(
        `composes_findings_of: ${dep.workflow}${dep.section ? ` (section: ${dep.section})` : ""} is ${evaluation.reason}. Consider running \`substrate run ${dep.workflow}\` first.`,
      );
    }
  }
  return result;
}

function evaluateDependency(
  dep: ComposedFinding,
  sidecar: SidecarRecord | null,
  _now: Date,
): CompositionCheckResult["dependencies"][number] {
  const base = {
    workflow: dep.workflow,
    section: dep.section,
    requireFreshWithin: dep["require-fresh-within"],
  };
  if (!sidecar) {
    return {
      ...base,
      sidecar: null,
      stale: true,
      reason: "no sidecar found",
    };
  }
  const limitMs = parseDuration(dep["require-fresh-within"]);
  if (limitMs === null) {
    // No limit declared (or unparseable) — sidecar present satisfies.
    return {
      ...base,
      sidecar,
      stale: false,
      reason: dep["require-fresh-within"]
        ? `require-fresh-within "${dep["require-fresh-within"]}" not parseable; treating as fresh`
        : "sidecar present (no freshness limit declared)",
    };
  }
  const ageMs = sidecar.ageHours * 60 * 60 * 1000;
  if (ageMs > limitMs) {
    const ageLabel =
      sidecar.ageDays > 0
        ? `${sidecar.ageDays}d`
        : `${sidecar.ageHours}h`;
    return {
      ...base,
      sidecar,
      stale: true,
      reason: `${ageLabel} since last run (older than require-fresh-within=${dep["require-fresh-within"]})`,
    };
  }
  return {
    ...base,
    sidecar,
    stale: false,
    reason: "fresh",
  };
}
