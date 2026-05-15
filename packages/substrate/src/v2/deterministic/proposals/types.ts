/**
 * Substrate v2 — Proposal type definitions (Phase B3, Primitive 9
 * Component C).
 *
 * Eight typed proposals per plan §3.9. Each carries:
 *   - `id`              : stable per-proposal identifier (workflow +
 *                         signature) so the queue can de-duplicate
 *                         across runs
 *   - `kind`            : discriminant; drives the applicator
 *   - `confidence`      : `high` | `medium` | `low`
 *   - `recurrence`      : how many runs the drift was observed in
 *   - `suggestedAction` : human-readable description of what the
 *                         applicator will do
 *   - `payload`         : kind-specific data the applicator consumes
 *   - `evidence`        : paths to session-event-logs that exhibit the
 *                         drift (linked sessions in the markdown shape)
 *   - `linkedDrift`     : the drift kind from `drift-detectors.ts`
 *
 * Discriminant: `kind`. Adding a new proposal kind requires a new
 * applicator entry in `../proposal-applicators.ts`.
 *
 * Layer: deterministic. These types live next to the queue I/O so the
 * applicators + classifier share one source of truth.
 */

import type { DriftKind } from "../../orchestrator/drift-detectors.js";

export type ProposalKind =
  | "add-to-workflow-step"
  | "add-to-memory"
  | "add-to-rule"
  | "add-to-standards-doc"
  | "add-to-adr"
  | "add-to-doc-check-registry"
  | "strengthen-context-load"
  | "cross-link-existing";

export type ProposalConfidence = "high" | "medium" | "low";
export type ProposalStatus = "pending" | "applied" | "rejected" | "deferred";

export interface ProposalBase {
  id: string;
  workflowId: string;
  kind: ProposalKind;
  confidence: ProposalConfidence;
  recurrence?: number;
  suggestedAction: string;
  linkedDrift: DriftKind;
  evidence?: string[];
  status: ProposalStatus;
  /** When the proposal was generated (ISO timestamp). */
  generatedAt: string;
}

export interface AddToWorkflowStepProposal extends ProposalBase {
  kind: "add-to-workflow-step";
  payload: {
    /** The id to use for the new step. */
    stepId: string;
    /** Human-readable step name. */
    stepName?: string;
    /** Step type — typically `prompt` for human-prompted ad-hoc checks. */
    stepType: "prompt" | "prompt-and-action" | "invoke-deterministic";
    /** Prompt body (for `prompt` / `prompt-and-action`). */
    prompt?: string;
    /** Shell line (for `invoke-deterministic`). */
    run?: string;
    /** Optional insertion anchor: insert after this step. */
    afterStep?: string;
    /** Whether the new step should require confirmation. */
    mustConfirm?: boolean;
  };
}

export interface AddToMemoryProposal extends ProposalBase {
  kind: "add-to-memory";
  payload: {
    /** Memory file id (becomes the filename stem). */
    name: string;
    /** Frontmatter type. */
    type: "feedback" | "project" | "reference" | "user";
    scope?: string;
    tags?: string[];
    /** Memory body — markdown. */
    body: string;
    /** When omitted, applicator computes from substrate's memory storage. */
    description?: string;
  };
}

export interface AddToRuleProposal extends ProposalBase {
  kind: "add-to-rule";
  payload: {
    ruleId: string;
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low";
    /** When true, the rule writes with `manual-review: true` (the safe default). */
    manualReview: boolean;
  };
}

export interface AddToStandardsDocProposal extends ProposalBase {
  kind: "add-to-standards-doc";
  payload: {
    /** Relative path under standards/ — e.g. `backend/python.md`. */
    docPath: string;
    /** Section heading the addition slots under. Optional — applicator
     *  appends to end of file when absent. */
    sectionHeading?: string;
    /** Suggested addition (plain markdown). */
    addition: string;
  };
}

export interface AddToAdrProposal extends ProposalBase {
  kind: "add-to-adr";
  payload: {
    /** ADR slug — becomes the filename. */
    slug: string;
    title: string;
    /** ADR body (the applicator wraps in the standard ADR template). */
    body: string;
  };
}

export interface AddToDocCheckRegistryProposal extends ProposalBase {
  kind: "add-to-doc-check-registry";
  payload: {
    docCheckId: string;
    description: string;
    /** Glob the check applies to. */
    triggerGlob: string;
    /** The doc the check requires. */
    requireDoc: string;
    severity: "must-fix" | "should-fix" | "nice-to-fix";
  };
}

export interface StrengthenContextLoadProposal extends ProposalBase {
  kind: "strengthen-context-load";
  payload: {
    /** Which context kind to extend. */
    contextKind: "standards" | "memory" | "rules" | "knowledge-sections";
    /** Values to add. Format depends on contextKind. */
    additions: string[];
  };
}

export interface CrossLinkExistingProposal extends ProposalBase {
  kind: "cross-link-existing";
  payload: {
    /** Source file the link should be added to. */
    sourcePath: string;
    /** Target artifact's relative path (becomes the wiki-link). */
    targetPath: string;
    /** Anchor text. */
    anchor: string;
  };
}

export type Proposal =
  | AddToWorkflowStepProposal
  | AddToMemoryProposal
  | AddToRuleProposal
  | AddToStandardsDocProposal
  | AddToAdrProposal
  | AddToDocCheckRegistryProposal
  | StrengthenContextLoadProposal
  | CrossLinkExistingProposal;
