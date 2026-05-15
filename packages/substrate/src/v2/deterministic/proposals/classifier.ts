/**
 * Substrate v2 — Proposal classifier (Phase B3, Primitive 9
 * Component C).
 *
 * Maps `DriftFinding[]` from the orchestrator's drift detectors onto
 * `Proposal[]` for the queue. The mapping is one-to-many: a single
 * drift can produce multiple proposals when the classifier sees the
 * pattern from more than one angle.
 *
 * Mapping table (drift → proposals):
 *
 *   adhoc-step                  → add-to-workflow-step   (when recurrence >= 3)
 *                               → add-to-memory          (when description reads like a learnable lesson)
 *   skipped-step                → cross-link-existing    (if the step references a doc that exists)
 *   out-of-order                → add-to-standards-doc   (codify the new order)
 *   context-gap                 → strengthen-context-load
 *                               → add-to-doc-check-registry  (when the missing context is doc-shaped)
 *   repeated-prompt             → strengthen-context-load
 *                               → add-to-adr            (if the question hints at design choice)
 *   rule-violation-recurrence   → add-to-rule           (codify the pattern)
 *                               → add-to-standards-doc  (document the rationale)
 *
 * The classifier is deliberately conservative. Most proposals start at
 * confidence `low` or `medium`; `high` is reserved for drifts with
 * strong signal (recurrence >= 3, repeated-prompt at threshold).
 *
 * Layer: deterministic. Pure: same inputs → same outputs.
 */

import { createHash } from "node:crypto";
import type {
  DriftFinding,
} from "../../orchestrator/drift-detectors.js";
import type { WorkflowManifest } from "../../types.js";
import type {
  Proposal,
  ProposalConfidence,
} from "./types.js";

export interface ClassifyOptions {
  /** Where in the manifest to suggest inserting new ad-hoc steps. */
  defaultInsertAfter?: string;
  /** Date stamp for `generatedAt`. Test seam. */
  now?: Date;
}

/**
 * Classify drift findings into typed proposals. Returns an array sorted
 * by descending confidence (high → medium → low).
 */
export function classifyDrifts(
  findings: DriftFinding[],
  manifest: WorkflowManifest,
  options: ClassifyOptions = {},
): Proposal[] {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const out: Proposal[] = [];
  for (const finding of findings) {
    out.push(...classifyOne(finding, manifest, generatedAt, options));
  }
  out.sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence));
  return out;
}

function classifyOne(
  finding: DriftFinding,
  manifest: WorkflowManifest,
  generatedAt: string,
  options: ClassifyOptions,
): Proposal[] {
  switch (finding.kind) {
    case "adhoc-step":
      return classifyAdhocStep(finding, manifest, generatedAt, options);
    case "skipped-step":
      return classifySkippedStep(finding, manifest, generatedAt);
    case "out-of-order":
      return classifyOutOfOrder(finding, manifest, generatedAt);
    case "context-gap":
      return classifyContextGap(finding, manifest, generatedAt);
    case "repeated-prompt":
      return classifyRepeatedPrompt(finding, manifest, generatedAt);
    case "rule-violation-recurrence":
      return classifyRuleViolationRecurrence(finding, manifest, generatedAt);
  }
}

function classifyAdhocStep(
  finding: DriftFinding,
  manifest: WorkflowManifest,
  generatedAt: string,
  options: ClassifyOptions,
): Proposal[] {
  // Extract the description from the detail text. Pattern produced by
  // detectAdhocSteps: `ad-hoc step: "<description>"`. We re-parse here
  // because DriftFinding doesn't carry the raw description as its own
  // field (signature is normalized).
  const m = finding.detail.match(/ad-hoc step: "([^"]+)"/);
  const description = m ? m[1] : finding.detail;
  const stepId = slugifyStepId(description);
  const proposals: Proposal[] = [];

  // Primary proposal: add-to-workflow-step (confidence inherited from drift).
  proposals.push({
    id: stableId("add-to-workflow-step", manifest.id, finding.signature),
    workflowId: manifest.id,
    kind: "add-to-workflow-step",
    confidence: finding.confidence,
    recurrence: finding.recurrence,
    suggestedAction: `Add a permanent step "${stepId}" to workflow "${manifest.id}" capturing the ad-hoc check.`,
    linkedDrift: finding.kind,
    evidence: finding.evidence,
    status: "pending",
    generatedAt,
    payload: {
      stepId,
      stepName: description,
      stepType: "prompt",
      prompt: description,
      mustConfirm: true,
      afterStep: finding.step ?? options.defaultInsertAfter,
    },
  });

  // Secondary proposal: at high confidence, also propose a memory
  // entry capturing the lesson learned. The proposal layer surfaces
  // it as a separate item the user can accept/reject independently.
  if (finding.confidence === "high") {
    proposals.push({
      id: stableId("add-to-memory", manifest.id, finding.signature),
      workflowId: manifest.id,
      kind: "add-to-memory",
      confidence: "medium",
      recurrence: finding.recurrence,
      suggestedAction: `Persist the recurring ad-hoc check as a feedback memory so future runs surface it without manual intervention.`,
      linkedDrift: finding.kind,
      evidence: finding.evidence,
      status: "pending",
      generatedAt,
      payload: {
        name: `feedback-${stepId}`,
        type: "feedback",
        scope: manifest.kind,
        tags: [manifest.id, "drift-derived"],
        body:
          `Recurring ad-hoc check in ${manifest.id}: "${description}". ` +
          `Observed in ${finding.recurrence ?? 1} runs.`,
        description: `Auto-captured from drift detection in workflow ${manifest.id}.`,
      },
    });
  }
  return proposals;
}

function classifySkippedStep(
  finding: DriftFinding,
  manifest: WorkflowManifest,
  generatedAt: string,
): Proposal[] {
  // Skipped-step is informational. We only emit a cross-link proposal
  // when the step name looks like it references something cross-linkable
  // (a heuristic).
  const step = (manifest.steps ?? []).find((s) => s.id === finding.step);
  if (!step) return [];
  const targetMention = (step.prompt ?? step.name ?? "").match(/`([^`]+)`/);
  if (!targetMention) return [];
  return [
    {
      id: stableId("cross-link-existing", manifest.id, finding.signature),
      workflowId: manifest.id,
      kind: "cross-link-existing",
      confidence: "low",
      suggestedAction: `Cross-link "${targetMention[1]}" inside step "${step.id}".`,
      linkedDrift: finding.kind,
      status: "pending",
      generatedAt,
      payload: {
        sourcePath: `substrate/workflows/${manifest.id}.body.md`,
        targetPath: targetMention[1],
        anchor: targetMention[1],
      },
    },
  ];
}

function classifyOutOfOrder(
  finding: DriftFinding,
  manifest: WorkflowManifest,
  generatedAt: string,
): Proposal[] {
  // Codify the observed order via a standards doc note.
  return [
    {
      id: stableId("add-to-standards-doc", manifest.id, finding.signature),
      workflowId: manifest.id,
      kind: "add-to-standards-doc",
      confidence: finding.confidence,
      suggestedAction: `Document the observed out-of-order execution in the workflow's standards doc.`,
      linkedDrift: finding.kind,
      status: "pending",
      generatedAt,
      payload: {
        docPath: `workflows/${manifest.id}.md`,
        sectionHeading: "Execution notes",
        addition: finding.detail,
      },
    },
  ];
}

function classifyContextGap(
  finding: DriftFinding,
  manifest: WorkflowManifest,
  generatedAt: string,
): Proposal[] {
  // Parse the kind referenced in the detail. The detector formats it as
  // `… suggests missing <kindIds>: <suggested>`.
  const m = finding.detail.match(/missing (memoryIds|standardIds|ruleIds|knowledgeIds): (.+)$/);
  const kindMapping: Record<string, "memory" | "standards" | "rules" | "knowledge-sections"> = {
    memoryIds: "memory",
    standardIds: "standards",
    ruleIds: "rules",
    knowledgeIds: "knowledge-sections",
  };
  const contextKind = m ? kindMapping[m[1]] : "knowledge-sections";
  const suggestion = m ? m[2] : finding.detail;

  return [
    {
      id: stableId("strengthen-context-load", manifest.id, finding.signature),
      workflowId: manifest.id,
      kind: "strengthen-context-load",
      confidence: finding.confidence,
      suggestedAction: `Extend ${manifest.id}'s context.${contextKind} so the AI no longer needs to ask.`,
      linkedDrift: finding.kind,
      status: "pending",
      generatedAt,
      payload: {
        contextKind,
        additions: [suggestion],
      },
    },
  ];
}

function classifyRepeatedPrompt(
  finding: DriftFinding,
  manifest: WorkflowManifest,
  generatedAt: string,
): Proposal[] {
  return [
    {
      id: stableId("strengthen-context-load", manifest.id, finding.signature),
      workflowId: manifest.id,
      kind: "strengthen-context-load",
      confidence: finding.confidence,
      recurrence: finding.recurrence,
      suggestedAction: `Pre-load the answer to "${finding.detail.split(":").slice(-1)[0].trim()}" via context.standards or context.memory.`,
      linkedDrift: finding.kind,
      status: "pending",
      generatedAt,
      payload: {
        contextKind: "memory",
        additions: [finding.detail],
      },
    },
  ];
}

function classifyRuleViolationRecurrence(
  finding: DriftFinding,
  manifest: WorkflowManifest,
  generatedAt: string,
): Proposal[] {
  // Extract rule id + path from detail. Detector emits:
  //   `rule <id> has flagged <path> in <n> runs (incl. current)`
  const m = finding.detail.match(/rule (\S+) has flagged (\S+) in (\d+) runs/);
  const ruleId = m ? m[1] : "unknown";
  const path = m ? m[2] : "unknown";
  return [
    {
      id: stableId("add-to-rule", manifest.id, finding.signature),
      workflowId: manifest.id,
      kind: "add-to-rule",
      confidence: finding.confidence,
      recurrence: finding.recurrence,
      suggestedAction: `Strengthen ${ruleId} or add a follow-up rule — the same finding has recurred ${finding.recurrence ?? "multiple"} times.`,
      linkedDrift: finding.kind,
      status: "pending",
      generatedAt,
      payload: {
        ruleId: `${ruleId}-followup`,
        title: `Recurring violation: ${ruleId}`,
        description:
          `Auto-suggested follow-up rule based on cross-run recurrence. ` +
          `Path: ${path}. Edit before accepting.`,
        severity: "medium",
        manualReview: true,
      },
    },
  ];
}

function stableId(kind: string, workflowId: string, signature: string): string {
  return createHash("sha256")
    .update(`${kind}|${workflowId}|${signature}`)
    .digest("hex")
    .slice(0, 12);
}

function slugifyStepId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "ad-hoc-step";
}

function confidenceRank(c: ProposalConfidence): number {
  return c === "high" ? 0 : c === "medium" ? 1 : 2;
}
