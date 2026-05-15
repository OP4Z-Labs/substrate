/**
 * Substrate v2 — Proposal queue (Phase B3, Primitive 9 Component D).
 *
 * On disk:
 *
 *   substrate/proposals/
 *     pending/<date>-<workflow>-<sha-prefix>.md
 *     applied/<date>-<id>.md
 *     rejected/<date>-<id>.md
 *
 * Each pending file groups one workflow run's proposals under a top
 * heading; each proposal becomes a `## <kind> proposal` subsection
 * carrying recurrence, confidence, suggested action, evidence, and a
 * payload code-block.
 *
 * The markdown is the source-of-truth representation; tooling (the
 * walker, the doctor stale-proposals check) reads it back via the
 * parser below. The applicators read the parsed Proposal objects, not
 * the markdown — but the markdown round-trips through `parsePendingFile`
 * losslessly for the field set we care about.
 *
 * Layer: deterministic. Pure file I/O — no AI, no network.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolveTargetRoot } from "../../../util/paths.js";
import type { Proposal, ProposalKind, ProposalStatus } from "./types.js";

export interface QueueLayout {
  /** `substrate/proposals/` root. */
  root: string;
  pendingDir: string;
  appliedDir: string;
  rejectedDir: string;
}

export function resolveQueueLayout(cwd?: string): QueueLayout {
  const root = join(resolveTargetRoot(cwd), "substrate", "proposals");
  return {
    root,
    pendingDir: join(root, "pending"),
    appliedDir: join(root, "applied"),
    rejectedDir: join(root, "rejected"),
  };
}

/**
 * Ensure the queue directory structure exists.
 */
export function ensureQueueLayout(cwd?: string): QueueLayout {
  const layout = resolveQueueLayout(cwd);
  for (const dir of [layout.root, layout.pendingDir, layout.appliedDir, layout.rejectedDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return layout;
}

export interface WritePendingFileOptions {
  workflowId: string;
  /** sha-prefix from the session log (8 hex). */
  shaPrefix: string;
  /** Proposals to write under this run's pending file. */
  proposals: Proposal[];
  cwd?: string;
  /** Override the date stamp used in the filename. */
  now?: Date;
}

export interface WritePendingFileResult {
  path: string;
  /** Number of proposals written. */
  count: number;
  /** Filename used (without directory). */
  filename: string;
}

/**
 * Write a pending proposals file for a single workflow run. File shape
 * matches plan §3.9 Component D + §7 worked example. Filename:
 * `<YYYY-MM-DD>-<workflow>-<sha-prefix>.md`.
 *
 * If a file already exists for the same (date, workflow, sha-prefix)
 * tuple — e.g. a re-run for the same workflow within the same day —
 * the new content REPLACES the old. We deliberately don't merge: the
 * second run's drift analysis is the authoritative one.
 */
export function writePendingFile(
  options: WritePendingFileOptions,
): WritePendingFileResult {
  const layout = ensureQueueLayout(options.cwd);
  const date = formatDate(options.now ?? new Date());
  const filename = `${date}-${options.workflowId}-${options.shaPrefix}.md`;
  const path = join(layout.pendingDir, filename);
  const body = renderPendingFile(options.workflowId, options.shaPrefix, options.proposals, date);
  writeFileSync(path, body, "utf8");
  return { path, count: options.proposals.length, filename };
}

/**
 * Render one pending file's markdown. Layout per plan §7 worked
 * example. Each proposal is its own `## <kind>` subsection.
 */
export function renderPendingFile(
  workflowId: string,
  shaPrefix: string,
  proposals: Proposal[],
  dateOverride?: string,
): string {
  const date = dateOverride ?? formatDate(new Date());
  const lines: string[] = [];
  lines.push(`# Proposal — ${workflowId} — ${date} (${shaPrefix})`);
  lines.push("");
  if (proposals.length === 0) {
    lines.push("_No drift detected; queue empty for this run._");
    lines.push("");
    return lines.join("\n");
  }
  for (const p of proposals) {
    lines.push(`## ${p.kind} (confidence: ${p.confidence})`);
    lines.push("");
    if (p.recurrence !== undefined) {
      lines.push(`- **Recurrence:** ${p.recurrence}`);
    }
    lines.push(`- **Linked drift:** ${p.linkedDrift}`);
    lines.push(`- **Suggested action:** ${p.suggestedAction}`);
    if (p.evidence && p.evidence.length > 0) {
      const items = p.evidence.map((e) => `\`${e}\``).join(", ");
      lines.push(`- **Linked sessions:** ${items}`);
    }
    lines.push(`- **Status:** ${p.status}`);
    lines.push(`- **Proposal id:** \`${p.id}\``);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(p, null, 2));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

export interface ParsedPendingFile {
  path: string;
  workflowId: string;
  date: string;
  shaPrefix: string;
  proposals: Proposal[];
  /** Parser warnings (proposals that couldn't be deserialised). */
  warnings: string[];
}

/**
 * Parse a pending proposal file back to its Proposal[] form. We rely
 * on the embedded JSON code blocks rather than re-parsing markdown
 * sections — that keeps the round-trip lossless for arbitrary payload
 * fields without coupling to the markdown layout.
 */
export function parsePendingFile(path: string): ParsedPendingFile {
  const warnings: string[] = [];
  const raw = readFileSync(path, "utf8");
  // Filename shape: <YYYY-MM-DD>-<workflow>-<8hex>.md
  const fname = path.split(/[\\/]/).pop() ?? "";
  const m = fname.match(/^(\d{4}-\d{2}-\d{2})-(.+)-([0-9a-f]{8})\.md$/);
  if (!m) {
    warnings.push(`filename does not match the queue convention: ${fname}`);
  }
  const date = m ? m[1] : "";
  const workflowId = m ? m[2] : "";
  const shaPrefix = m ? m[3] : "";

  const proposals: Proposal[] = [];
  const codeBlockRe = /```json\n([\s\S]+?)\n```/g;
  let cb: RegExpExecArray | null;
  while ((cb = codeBlockRe.exec(raw))) {
    try {
      const parsed = JSON.parse(cb[1]) as Proposal;
      if (parsed && parsed.id && parsed.kind) {
        proposals.push(parsed);
      } else {
        warnings.push(`code block missing required Proposal fields in ${path}`);
      }
    } catch (err) {
      warnings.push(
        `failed to parse proposal JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { path, workflowId, date, shaPrefix, proposals, warnings };
}

/**
 * Walk the pending directory, yielding parsed pending files sorted by
 * date ascending (oldest first).
 */
export function listPending(cwd?: string): ParsedPendingFile[] {
  const layout = resolveQueueLayout(cwd);
  if (!existsSync(layout.pendingDir)) return [];
  const entries = readdirSync(layout.pendingDir).filter((n) => n.endsWith(".md"));
  entries.sort();
  return entries.map((n) => parsePendingFile(join(layout.pendingDir, n)));
}

export interface ListByStatusOptions {
  cwd?: string;
  status: Extract<ProposalStatus, "applied" | "rejected">;
}

/**
 * Walk the applied / rejected directories. Each file there holds ONE
 * proposal (we split per-proposal on accept/reject) so the parser
 * returns one ParsedPendingFile entry per file.
 */
export function listByStatus(options: ListByStatusOptions): ParsedPendingFile[] {
  const layout = resolveQueueLayout(options.cwd);
  const dir = options.status === "applied" ? layout.appliedDir : layout.rejectedDir;
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir).filter((n) => n.endsWith(".md"));
  entries.sort();
  return entries.map((n) => parsePendingFile(join(dir, n)));
}

export interface MoveProposalOptions {
  cwd?: string;
  /** Pending file the proposal originated from. */
  fromPath: string;
  /** Proposal to move. */
  proposal: Proposal;
  /** Where to move it. */
  toStatus: "applied" | "rejected";
  /** Optional reason recorded in the header. */
  reason?: string;
  /** Override the date stamp used in the destination filename. */
  now?: Date;
}

export interface MoveProposalResult {
  /** Path to the destination single-proposal markdown. */
  destPath: string;
  /** If true, the source pending file became empty + was deleted. */
  pendingFileRemoved: boolean;
  /** Remaining proposals (after removal) in the source pending file. */
  remaining: number;
}

/**
 * Move one proposal from pending to applied/rejected. The source
 * pending file is rewritten without that proposal; if all proposals
 * are gone, the source file is removed.
 *
 * The destination is a per-proposal file so the walker can list them
 * one-by-one when reviewing history.
 */
export function moveProposal(options: MoveProposalOptions): MoveProposalResult {
  const layout = ensureQueueLayout(options.cwd);
  const destDir = options.toStatus === "applied" ? layout.appliedDir : layout.rejectedDir;
  const date = formatDate(options.now ?? new Date());
  const destFilename = `${date}-${options.proposal.id}.md`;
  const destPath = join(destDir, destFilename);

  const updatedProposal: Proposal = {
    ...options.proposal,
    status: options.toStatus,
  };
  const headerLines: string[] = [];
  headerLines.push(`# ${options.toStatus === "applied" ? "Applied" : "Rejected"} — ${updatedProposal.id}`);
  headerLines.push("");
  headerLines.push(
    `- **${options.toStatus === "applied" ? "Applied" : "Rejected"} at:** ${(options.now ?? new Date()).toISOString()}`,
  );
  headerLines.push(`- **Workflow:** ${updatedProposal.workflowId}`);
  headerLines.push(`- **Kind:** ${updatedProposal.kind}`);
  if (options.reason) {
    headerLines.push(`- **Reason:** ${options.reason}`);
  }
  headerLines.push("");
  headerLines.push("```json");
  headerLines.push(JSON.stringify(updatedProposal, null, 2));
  headerLines.push("```");
  headerLines.push("");
  writeFileSync(destPath, headerLines.join("\n"), "utf8");

  // Rewrite source — strip the moved proposal.
  const sourceParsed = parsePendingFile(options.fromPath);
  const remaining = sourceParsed.proposals.filter((p) => p.id !== options.proposal.id);
  let pendingFileRemoved = false;
  if (remaining.length === 0) {
    rmSync(options.fromPath);
    pendingFileRemoved = true;
  } else {
    const body = renderPendingFile(
      sourceParsed.workflowId,
      sourceParsed.shaPrefix,
      remaining,
      sourceParsed.date,
    );
    writeFileSync(options.fromPath, body, "utf8");
  }
  return { destPath, pendingFileRemoved, remaining: remaining.length };
}

/**
 * Soft-update a proposal inside a pending file. Used by `defer` (which
 * adjusts status + maybe a timestamp) and by `edit` (which replaces
 * the proposal with a user-modified version).
 */
export interface UpdatePendingOptions {
  pendingPath: string;
  updated: Proposal;
}

export function updatePendingProposal(options: UpdatePendingOptions): void {
  const parsed = parsePendingFile(options.pendingPath);
  const next = parsed.proposals.map((p) =>
    p.id === options.updated.id ? options.updated : p,
  );
  const body = renderPendingFile(parsed.workflowId, parsed.shaPrefix, next, parsed.date);
  writeFileSync(options.pendingPath, body, "utf8");
}

function formatDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convenience: count proposals across the queue, optionally filtered by
 * kind. Used by `substrate doctor` for the stale-proposals check (B4)
 * and by the walk command's summary banner.
 */
export interface QueueStats {
  pendingProposals: number;
  pendingFiles: number;
  appliedFiles: number;
  rejectedFiles: number;
  byKind: Partial<Record<ProposalKind, number>>;
}

export function queueStats(cwd?: string): QueueStats {
  const pending = listPending(cwd);
  const applied = listByStatus({ status: "applied", cwd });
  const rejected = listByStatus({ status: "rejected", cwd });
  const byKind: Partial<Record<ProposalKind, number>> = {};
  let pendingCount = 0;
  for (const p of pending) {
    for (const prop of p.proposals) {
      byKind[prop.kind] = (byKind[prop.kind] ?? 0) + 1;
      pendingCount += 1;
    }
  }
  return {
    pendingProposals: pendingCount,
    pendingFiles: pending.length,
    appliedFiles: applied.length,
    rejectedFiles: rejected.length,
    byKind,
  };
}

/**
 * Update the status field on a proposal without moving its file. Used
 * for the `defer` action — keeps the proposal in pending but flags it
 * as deferred.
 *
 * `moveProposal` exists separately because applied/rejected proposals
 * physically migrate; deferred ones stay in place. Renaming the
 * directory layout to support a per-status directory for `deferred`
 * was considered but rejected — deferred proposals re-surface in the
 * next walk anyway; a separate dir would just hide them.
 */
export function deferProposal(opts: {
  pendingPath: string;
  proposalId: string;
}): boolean {
  const parsed = parsePendingFile(opts.pendingPath);
  const idx = parsed.proposals.findIndex((p) => p.id === opts.proposalId);
  if (idx < 0) return false;
  parsed.proposals[idx] = { ...parsed.proposals[idx], status: "deferred" };
  const body = renderPendingFile(
    parsed.workflowId,
    parsed.shaPrefix,
    parsed.proposals,
    parsed.date,
  );
  writeFileSync(opts.pendingPath, body, "utf8");
  return true;
}
