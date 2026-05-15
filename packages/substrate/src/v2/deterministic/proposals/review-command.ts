/**
 * Substrate v2 — `substrate review --proposals` (Phase B3, Primitive 9
 * Component E, walker side).
 *
 * Walks `substrate/proposals/pending/`, presents each proposal with a
 * diff preview, and offers five controls: accept / reject / edit /
 * defer / skip.
 *
 * Controls
 * --------
 *   accept  → applicator writes the file, proposal moves to applied/
 *   reject  → proposal moves to rejected/ (with optional reason)
 *   edit    → user (or batch caller) supplies an edited Proposal; the
 *             new version stays in pending until accepted on a later
 *             walk
 *   defer   → proposal stays in pending, status becomes deferred
 *   skip    → proposal stays in pending, status unchanged (re-shown next walk)
 *
 * Modes
 * -----
 *   --dry-run         → preview only; never moves / writes anything
 *   --batch-confirm   → no per-proposal prompt; apply every high-confidence
 *                       proposal automatically, defer everything else.
 *                       Used by `weekly-proposal-walk` so the scheduled
 *                       flow doesn't block on input.
 *
 * Layer: deterministic (the walking + queue manipulation is pure I/O).
 * Interactive mode optionally consumes @inquirer/prompts; tests inject
 * a `decisions` array to bypass the prompt.
 */

import kleur from "kleur";
import {
  applyProposal,
  type ApplicatorResult,
} from "./applicators.js";
import {
  deferProposal,
  listPending,
  moveProposal,
  updatePendingProposal,
  type ParsedPendingFile,
} from "./queue.js";
import type { Proposal } from "./types.js";

export type WalkAction =
  | "accept"
  | "reject"
  | "edit"
  | "defer"
  | "skip";

export interface WalkDecision {
  proposalId: string;
  action: WalkAction;
  /** Reason recorded when action=reject. */
  reason?: string;
  /** Replacement proposal when action=edit. */
  editedProposal?: Proposal;
}

export interface WalkProposalsOptions {
  cwd?: string;
  dryRun?: boolean;
  batchConfirm?: boolean;
  /** Pre-supplied decisions (test seam + batch + programmatic API). */
  decisions?: WalkDecision[];
  /** Suppress informational output. */
  quiet?: boolean;
  /** Emit machine-readable JSON instead of human output. */
  json?: boolean;
}

export interface WalkProposalsOutcome {
  proposalId: string;
  action: WalkAction;
  /** Apply result, when action=accept. */
  applied?: ApplicatorResult;
  /** Defer/reject/skip have no apply, but we keep a uniform message. */
  message: string;
}

export interface WalkProposalsResult {
  /** Per-proposal outcome (one entry per pending proposal walked). */
  outcomes: WalkProposalsOutcome[];
  /** Aggregate counts. */
  summary: {
    accepted: number;
    rejected: number;
    edited: number;
    deferred: number;
    skipped: number;
    total: number;
  };
}

/**
 * The actual walker. Public entry. Programmatic callers pass
 * `decisions` directly; the CLI command (CLI wiring lives in
 * `src/cli.ts`) builds them from interactive prompts.
 */
export async function walkProposals(
  options: WalkProposalsOptions = {},
): Promise<WalkProposalsResult> {
  const pending = listPending(options.cwd);
  const summary = {
    accepted: 0,
    rejected: 0,
    edited: 0,
    deferred: 0,
    skipped: 0,
    total: 0,
  };
  const outcomes: WalkProposalsOutcome[] = [];

  if (!options.quiet && !options.json) {
    if (pending.length === 0) {
      console.log(kleur.green("✓ no pending proposals."));
    } else {
      const proposalCount = pending.reduce((n, f) => n + f.proposals.length, 0);
      console.log(
        kleur.bold(
          `\n${proposalCount} pending proposal${proposalCount === 1 ? "" : "s"} across ${pending.length} run file${pending.length === 1 ? "" : "s"}:\n`,
        ),
      );
    }
  }

  for (const file of pending) {
    for (const proposal of file.proposals) {
      summary.total += 1;
      const decision = resolveDecision(proposal, options);
      const outcome = await execDecision(file, proposal, decision, options);
      outcomes.push(outcome);
      switch (decision.action) {
        case "accept":
          summary.accepted += 1;
          break;
        case "reject":
          summary.rejected += 1;
          break;
        case "edit":
          summary.edited += 1;
          break;
        case "defer":
          summary.deferred += 1;
          break;
        case "skip":
          summary.skipped += 1;
          break;
      }
    }
  }

  const result: WalkProposalsResult = { outcomes, summary };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!options.quiet && summary.total > 0) {
    console.log(
      "\n" +
        kleur.bold("Summary: ") +
        `${kleur.green(String(summary.accepted))} accepted, ` +
        `${kleur.red(String(summary.rejected))} rejected, ` +
        `${kleur.cyan(String(summary.edited))} edited, ` +
        `${kleur.yellow(String(summary.deferred))} deferred, ` +
        `${kleur.dim(String(summary.skipped))} skipped`,
    );
  }

  return result;
}

/**
 * Pick a decision for a proposal. Precedence:
 *   1. explicit entry in options.decisions
 *   2. --batch-confirm mode → accept high-confidence, defer the rest
 *   3. interactive mode → skip silently (the CLI layer wires the prompt)
 *
 * We never throw on missing decisions — the safe default is to skip.
 */
function resolveDecision(
  proposal: Proposal,
  options: WalkProposalsOptions,
): WalkDecision {
  const supplied = options.decisions?.find((d) => d.proposalId === proposal.id);
  if (supplied) return supplied;
  if (options.batchConfirm) {
    return {
      proposalId: proposal.id,
      action: proposal.confidence === "high" ? "accept" : "defer",
    };
  }
  return { proposalId: proposal.id, action: "skip" };
}

async function execDecision(
  file: ParsedPendingFile,
  proposal: Proposal,
  decision: WalkDecision,
  options: WalkProposalsOptions,
): Promise<WalkProposalsOutcome> {
  if (!options.quiet && !options.json) {
    renderProposalHeader(proposal);
  }
  switch (decision.action) {
    case "accept": {
      const applied = applyProposal(proposal, {
        cwd: options.cwd,
        dryRun: options.dryRun,
      });
      if (!options.dryRun && applied.ok) {
        moveProposal({
          cwd: options.cwd,
          fromPath: file.path,
          proposal,
          toStatus: "applied",
        });
      }
      if (!options.quiet && !options.json) {
        console.log(
          (applied.ok ? kleur.green("✓ accepted") : kleur.red("✗ accept failed")) +
            kleur.dim(` — ${applied.message}`),
        );
      }
      return {
        proposalId: proposal.id,
        action: "accept",
        applied,
        message: applied.message,
      };
    }
    case "reject": {
      if (!options.dryRun) {
        moveProposal({
          cwd: options.cwd,
          fromPath: file.path,
          proposal,
          toStatus: "rejected",
          reason: decision.reason,
        });
      }
      if (!options.quiet && !options.json) {
        console.log(
          kleur.red("✗ rejected") +
            (decision.reason ? kleur.dim(` — ${decision.reason}`) : ""),
        );
      }
      return {
        proposalId: proposal.id,
        action: "reject",
        message: decision.reason ?? "rejected",
      };
    }
    case "edit": {
      if (!decision.editedProposal) {
        return {
          proposalId: proposal.id,
          action: "edit",
          message: "edit action chosen but no editedProposal supplied",
        };
      }
      if (!options.dryRun) {
        updatePendingProposal({
          pendingPath: file.path,
          updated: decision.editedProposal,
        });
      }
      if (!options.quiet && !options.json) {
        console.log(kleur.cyan("✎ edited") + kleur.dim(" — proposal updated in pending queue"));
      }
      return {
        proposalId: proposal.id,
        action: "edit",
        message: "proposal updated; remains pending",
      };
    }
    case "defer": {
      if (!options.dryRun) {
        deferProposal({ pendingPath: file.path, proposalId: proposal.id });
      }
      if (!options.quiet && !options.json) {
        console.log(kleur.yellow("↷ deferred") + kleur.dim(" — remains in pending, status=deferred"));
      }
      return {
        proposalId: proposal.id,
        action: "defer",
        message: "deferred (remains in pending queue)",
      };
    }
    case "skip":
    default:
      if (!options.quiet && !options.json) {
        console.log(kleur.dim("· skipped — re-surface on next walk"));
      }
      return {
        proposalId: proposal.id,
        action: "skip",
        message: "skipped (no change)",
      };
  }
}

function renderProposalHeader(proposal: Proposal): void {
  console.log(
    "\n" +
      kleur.bold(`Proposal ${proposal.id}: ${proposal.kind}`) +
      kleur.dim(
        ` (confidence: ${proposal.confidence}${proposal.recurrence ? `, recurrence: ${proposal.recurrence}` : ""})`,
      ),
  );
  console.log(`  ${proposal.suggestedAction}`);
  if (proposal.evidence && proposal.evidence.length > 0) {
    console.log(kleur.dim(`  evidence: ${proposal.evidence.join(", ")}`));
  }
}
