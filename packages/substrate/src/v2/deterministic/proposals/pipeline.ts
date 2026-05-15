/**
 * Substrate v2 — Proposal pipeline orchestration glue (Phase B3,
 * Primitive 9, integration layer per plan §5.4).
 *
 * Wires together:
 *
 *   detect drift  →  classify proposals  →  write to pending queue
 *
 * Exposed as `runProposalPipeline()`. Called by:
 *
 *   - The `auto-drift-detect` hook (real B3 handler) after every
 *     workflow run.
 *   - The `substrate review --propose <session-log>` standalone CLI
 *     entry (plan §5.4) for offline analysis.
 *
 * Layer: deterministic (drift detection is pure pattern-matching).
 * The apply step in `proposal-applicators.ts` is mixed-determinism
 * because some applicators write AI-drafted edits via the orchestrator.
 */

import {
  runDriftDetectors,
  type DriftFinding,
  type RuleViolationRecord,
} from "../../orchestrator/drift-detectors.js";
import type { WorkflowManifest } from "../../types.js";
import { classifyDrifts } from "./classifier.js";
import { writePendingFile } from "./queue.js";
import type { Proposal } from "./types.js";

export interface RunProposalPipelineOptions {
  manifest: WorkflowManifest;
  sessionLogPath: string;
  /** sha-prefix from the session log filename. */
  shaPrefix: string;
  cwd?: string;
  /** Cross-session history cap. */
  historyLimit?: number;
  /** Optional audit-side recurrence records. */
  ruleViolationRecords?: RuleViolationRecord[];
  /** When true, do not write the pending file (used by --dry-run). */
  inMemoryOnly?: boolean;
  /** Test seam for the date stamp. */
  now?: Date;
}

export interface RunProposalPipelineResult {
  /** Drift findings produced by the detectors. */
  drifts: DriftFinding[];
  /** Proposals after classification. */
  proposals: Proposal[];
  /** Path the pending file was written to (null when inMemoryOnly). */
  pendingPath: string | null;
  /** Warnings emitted by detectors / classifier. */
  warnings: string[];
}

export function runProposalPipeline(
  options: RunProposalPipelineOptions,
): RunProposalPipelineResult {
  const detection = runDriftDetectors({
    manifest: options.manifest,
    sessionLogPath: options.sessionLogPath,
    cwd: options.cwd,
    historyLimit: options.historyLimit,
    ruleViolationRecords: options.ruleViolationRecords,
  });
  const proposals = classifyDrifts(detection.findings, options.manifest, {
    now: options.now,
  });
  let pendingPath: string | null = null;
  if (!options.inMemoryOnly && proposals.length > 0) {
    const r = writePendingFile({
      workflowId: options.manifest.id,
      shaPrefix: options.shaPrefix,
      proposals,
      cwd: options.cwd,
      now: options.now,
    });
    pendingPath = r.path;
  }
  return {
    drifts: detection.findings,
    proposals,
    pendingPath,
    warnings: detection.warnings,
  };
}

/**
 * Extract the workflow id + sha-prefix from a session log filename.
 * Returns null when the filename doesn't match the convention.
 */
export function parseSessionLogFilename(
  path: string,
): { workflowId: string; shaPrefix: string } | null {
  const fname = path.split(/[\\/]/).pop() ?? "";
  const m = fname.match(/^(.+)-([0-9a-f]{8})\.jsonl$/);
  if (!m) return null;
  return { workflowId: m[1], shaPrefix: m[2] };
}
