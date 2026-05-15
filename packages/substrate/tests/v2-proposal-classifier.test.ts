/**
 * Tests for the drift→proposal classifier (Phase B3, Primitive 9
 * Component C).
 */

import { describe, it, expect } from "vitest";
import { classifyDrifts } from "../src/v2/deterministic/proposals/classifier.js";
import type { DriftFinding } from "../src/v2/orchestrator/drift-detectors.js";
import type { WorkflowManifest } from "../src/v2/types.js";

const MANIFEST: WorkflowManifest = {
  schema_version: "v2.0",
  id: "tackle-task",
  name: "Tackle task",
  kind: "task-tackle",
  steps: [
    { id: "research", type: "prompt", prompt: "research" },
    { id: "implement", type: "prompt", prompt: "implement" },
    { id: "tests", type: "prompt", prompt: "tests" },
  ],
};

const NOW = new Date("2026-05-15T12:00:00Z");

describe("classifyDrifts — adhoc-step", () => {
  it("emits add-to-workflow-step with the same confidence as the drift", () => {
    const drift: DriftFinding = {
      kind: "adhoc-step",
      signature: "adhoc:check migration guide",
      detail: 'ad-hoc step: "check migration guide reflects schema change"',
      step: "implement",
      recurrence: 3,
      confidence: "high",
    };
    const out = classifyDrifts([drift], MANIFEST, { now: NOW });
    expect(out.length).toBeGreaterThan(0);
    const workflowProposal = out.find((p) => p.kind === "add-to-workflow-step");
    expect(workflowProposal).toBeDefined();
    expect(workflowProposal!.confidence).toBe("high");
    expect(workflowProposal!.payload).toMatchObject({
      stepType: "prompt",
      mustConfirm: true,
      afterStep: "implement",
    });
  });

  it("piggy-backs an add-to-memory proposal at high confidence", () => {
    const drift: DriftFinding = {
      kind: "adhoc-step",
      signature: "adhoc:high recurrence",
      detail: 'ad-hoc step: "verify migration guide"',
      recurrence: 5,
      confidence: "high",
    };
    const out = classifyDrifts([drift], MANIFEST, { now: NOW });
    const kinds = out.map((p) => p.kind);
    expect(kinds).toContain("add-to-workflow-step");
    expect(kinds).toContain("add-to-memory");
    const mem = out.find((p) => p.kind === "add-to-memory")!;
    expect(mem.payload).toMatchObject({
      type: "feedback",
      tags: expect.arrayContaining(["tackle-task"]),
    });
  });

  it("does NOT emit add-to-memory at low confidence", () => {
    const drift: DriftFinding = {
      kind: "adhoc-step",
      signature: "adhoc:once",
      detail: 'ad-hoc step: "first occurrence"',
      recurrence: 1,
      confidence: "low",
    };
    const out = classifyDrifts([drift], MANIFEST, { now: NOW });
    expect(out.find((p) => p.kind === "add-to-memory")).toBeUndefined();
  });
});

describe("classifyDrifts — context-gap", () => {
  it("maps `missing knowledgeIds` to strengthen-context-load with knowledge-sections", () => {
    const drift: DriftFinding = {
      kind: "context-gap",
      signature: "contextgap:knowledgeIds:schema",
      detail:
        'prompt "what is the schema change?…" suggests missing knowledgeIds: include schema knowledge in context.knowledge-sections',
      confidence: "medium",
    };
    const out = classifyDrifts([drift], MANIFEST, { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("strengthen-context-load");
    if (out[0].kind === "strengthen-context-load") {
      expect(out[0].payload.contextKind).toBe("knowledge-sections");
    }
  });

  it("maps `missing memoryIds` to strengthen-context-load with memory", () => {
    const drift: DriftFinding = {
      kind: "context-gap",
      signature: "x",
      detail:
        'prompt "…" suggests missing memoryIds: broaden context.memory filters so the relevant feedback memories load',
      confidence: "medium",
    };
    const out = classifyDrifts([drift], MANIFEST, { now: NOW });
    if (out[0].kind === "strengthen-context-load") {
      expect(out[0].payload.contextKind).toBe("memory");
    }
  });
});

describe("classifyDrifts — repeated-prompt", () => {
  it("maps to strengthen-context-load with high confidence", () => {
    const drift: DriftFinding = {
      kind: "repeated-prompt",
      signature: "repeated:foo",
      detail: 'prompt repeated 4 times: "which rule applies to api endpoints"',
      recurrence: 4,
      confidence: "high",
    };
    const out = classifyDrifts([drift], MANIFEST, { now: NOW });
    expect(out[0].kind).toBe("strengthen-context-load");
    expect(out[0].confidence).toBe("high");
  });
});

describe("classifyDrifts — rule-violation-recurrence", () => {
  it("maps to add-to-rule with manualReview true", () => {
    const drift: DriftFinding = {
      kind: "rule-violation-recurrence",
      signature: "recurrence:BE-PY-001:apps/foo.py:",
      detail: "rule BE-PY-001 has flagged apps/foo.py in 4 runs (incl. current)",
      recurrence: 4,
      confidence: "medium",
    };
    const out = classifyDrifts([drift], MANIFEST, { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("add-to-rule");
    if (out[0].kind === "add-to-rule") {
      expect(out[0].payload.manualReview).toBe(true);
      expect(out[0].payload.ruleId).toBe("BE-PY-001-followup");
    }
  });
});

describe("classifyDrifts — out-of-order", () => {
  it("maps to add-to-standards-doc with the workflow's doc path", () => {
    const drift: DriftFinding = {
      kind: "out-of-order",
      signature: "outoforder:tackle-task:tests->implement",
      detail: 'step "implement" started after "tests" but is declared earlier in the manifest',
      step: "implement",
      confidence: "medium",
    };
    const out = classifyDrifts([drift], MANIFEST, { now: NOW });
    expect(out[0].kind).toBe("add-to-standards-doc");
    if (out[0].kind === "add-to-standards-doc") {
      expect(out[0].payload.docPath).toBe("workflows/tackle-task.md");
    }
  });
});

describe("classifyDrifts — skipped-step", () => {
  it("emits cross-link-existing when the skipped step references a backticked path", () => {
    const manifestWithLink: WorkflowManifest = {
      ...MANIFEST,
      steps: [
        ...(MANIFEST.steps ?? []),
        {
          id: "verify-changelog",
          type: "prompt",
          prompt: "verify `CHANGELOG.md` reflects the change",
        },
      ],
    };
    const drift: DriftFinding = {
      kind: "skipped-step",
      signature: "skipped:tackle-task:verify-changelog",
      detail: 'manifest step "verify-changelog" was not started',
      step: "verify-changelog",
      confidence: "low",
    };
    const out = classifyDrifts([drift], manifestWithLink, { now: NOW });
    expect(out[0].kind).toBe("cross-link-existing");
    if (out[0].kind === "cross-link-existing") {
      expect(out[0].payload.targetPath).toBe("CHANGELOG.md");
    }
  });

  it("emits nothing when the step has no backticked target", () => {
    const drift: DriftFinding = {
      kind: "skipped-step",
      signature: "skipped:tackle-task:research",
      detail: 'manifest step "research" was not started',
      step: "research",
      confidence: "low",
    };
    expect(classifyDrifts([drift], MANIFEST, { now: NOW })).toHaveLength(0);
  });
});

describe("classifyDrifts — ordering", () => {
  it("sorts proposals high → medium → low by confidence", () => {
    const drifts: DriftFinding[] = [
      {
        kind: "adhoc-step",
        signature: "a",
        detail: 'ad-hoc step: "x"',
        recurrence: 1,
        confidence: "low",
      },
      {
        kind: "repeated-prompt",
        signature: "b",
        detail: 'prompt repeated 3 times: "y"',
        recurrence: 3,
        confidence: "high",
      },
    ];
    const out = classifyDrifts(drifts, MANIFEST, { now: NOW });
    expect(out[0].confidence).toBe("high");
    expect(out[out.length - 1].confidence).toBe("low");
  });
});
