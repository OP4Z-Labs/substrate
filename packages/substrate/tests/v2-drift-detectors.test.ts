/**
 * Tests for the six drift detectors (Phase B3, Primitive 9 Component B).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionEventWriter,
  resolveSessionLogPath,
  type SessionEvent,
} from "../src/v2/orchestrator/session-log.js";
import {
  REPEATED_PROMPT_THRESHOLD,
  detectAdhocSteps,
  detectContextGaps,
  detectOutOfOrder,
  detectRepeatedPrompts,
  detectRuleViolationRecurrence,
  detectSkippedSteps,
  runDriftDetectors,
} from "../src/v2/orchestrator/drift-detectors.js";
import type { WorkflowManifest } from "../src/v2/types.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-drift-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const MANIFEST: WorkflowManifest = {
  schema_version: "v2.0",
  id: "tackle-task",
  name: "Tackle task",
  steps: [
    { id: "research", type: "prompt", prompt: "research" },
    { id: "implement", type: "prompt", prompt: "implement" },
    { id: "tests", type: "prompt", prompt: "tests" },
  ],
};

function makeEvents(overrides: Partial<SessionEvent>[]): SessionEvent[] {
  // Helper: synthesize a full run from a small list of overrides.
  return overrides as SessionEvent[];
}

describe("detectAdhocSteps", () => {
  it("emits one finding per unique ad-hoc step description", () => {
    const events = makeEvents([
      { ts: "2026-01-01T00:00:00Z", event: "workflow-start", workflow: "tackle-task", "manifest-hash": "x" },
      { ts: "2026-01-01T00:00:01Z", event: "step-start", step: "research" },
      {
        ts: "2026-01-01T00:00:02Z",
        event: "adhoc-step",
        description: "check migration guide reflects schema change",
        origin: "user-requested",
        "at-step": "research",
      },
      {
        ts: "2026-01-01T00:00:03Z",
        event: "adhoc-step",
        description: "verify rollback path",
        origin: "user-requested",
        "at-step": "research",
      },
    ]);
    const findings = detectAdhocSteps(events, MANIFEST);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.kind)).toEqual(["adhoc-step", "adhoc-step"]);
    expect(findings[0].confidence).toBe("low");
    expect(findings[0].recurrence).toBe(1);
  });

  it("dedupes repeated descriptions within the same run", () => {
    const events = makeEvents([
      {
        ts: "2026-01-01T00:00:00Z",
        event: "adhoc-step",
        description: "same description",
        origin: "user-requested",
      },
      {
        ts: "2026-01-01T00:00:01Z",
        event: "adhoc-step",
        description: "same description",
        origin: "user-requested",
      },
    ]);
    expect(detectAdhocSteps(events, MANIFEST)).toHaveLength(1);
  });

  it("scales confidence with cross-session recurrence", () => {
    const current = makeEvents([
      {
        ts: "2026-01-01T00:00:00Z",
        event: "adhoc-step",
        description: "check migration guide reflects schema change",
        origin: "user-requested",
      },
    ]);
    const prior = [
      makeEvents([
        {
          ts: "2025-12-31T00:00:00Z",
          event: "adhoc-step",
          description: "check migration guide reflects schema change",
          origin: "user-requested",
        },
      ]),
      makeEvents([
        {
          ts: "2025-12-30T00:00:00Z",
          event: "adhoc-step",
          description: "check migration guide reflects schema change",
          origin: "user-requested",
        },
      ]),
    ];
    const findings = detectAdhocSteps(current, MANIFEST, prior);
    expect(findings[0].confidence).toBe("high");
    expect(findings[0].recurrence).toBe(3);
  });
});

describe("detectSkippedSteps", () => {
  it("flags manifest steps that didn't receive a step-start", () => {
    const events = makeEvents([
      { ts: "t", event: "step-start", step: "research" },
      { ts: "t", event: "step-start", step: "implement" },
      // 'tests' missing
    ]);
    const findings = detectSkippedSteps(events, MANIFEST);
    expect(findings).toHaveLength(1);
    expect(findings[0].step).toBe("tests");
    expect(findings[0].confidence).toBe("low");
  });

  it("emits no findings when all steps started", () => {
    const events = makeEvents([
      { ts: "t", event: "step-start", step: "research" },
      { ts: "t", event: "step-start", step: "implement" },
      { ts: "t", event: "step-start", step: "tests" },
    ]);
    expect(detectSkippedSteps(events, MANIFEST)).toHaveLength(0);
  });
});

describe("detectOutOfOrder", () => {
  it("flags a step that started before its predecessor in the manifest", () => {
    const events = makeEvents([
      { ts: "t", event: "step-start", step: "research" },
      { ts: "t", event: "step-start", step: "tests" },     // skips ahead
      { ts: "t", event: "step-start", step: "implement" }, // jumps back
    ]);
    const findings = detectOutOfOrder(events, MANIFEST);
    expect(findings.length).toBeGreaterThan(0);
    const inversion = findings[0];
    expect(inversion.kind).toBe("out-of-order");
    expect(inversion.step).toBe("implement");
  });

  it("emits nothing for in-order execution", () => {
    const events = makeEvents([
      { ts: "t", event: "step-start", step: "research" },
      { ts: "t", event: "step-start", step: "implement" },
      { ts: "t", event: "step-start", step: "tests" },
    ]);
    expect(detectOutOfOrder(events, MANIFEST)).toHaveLength(0);
  });
});

describe("detectContextGaps", () => {
  it("flags prompts about schema when knowledge wasn't loaded", () => {
    const events = makeEvents([
      {
        ts: "t",
        event: "prompt-issued",
        step: "implement",
        prompt: "what's the schema change for users.email?",
      },
    ]);
    const findings = detectContextGaps(events, {
      memoryIds: [],
      standardIds: [],
      ruleIds: [],
      knowledgeIds: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("context-gap");
  });

  it("does not flag when the relevant context kind was loaded", () => {
    const events = makeEvents([
      {
        ts: "t",
        event: "prompt-issued",
        step: "implement",
        prompt: "what's the schema?",
      },
    ]);
    const findings = detectContextGaps(events, {
      memoryIds: [],
      standardIds: [],
      ruleIds: [],
      knowledgeIds: ["db-schema"],
    });
    expect(findings).toHaveLength(0);
  });

  it("dedupes multiple matching prompts of the same kind", () => {
    const events = makeEvents([
      { ts: "t", event: "prompt-issued", prompt: "what's the schema for X?" },
      { ts: "t", event: "prompt-issued", prompt: "what's the schema for Y?" },
    ]);
    const findings = detectContextGaps(events, {
      memoryIds: [],
      standardIds: [],
      ruleIds: [],
      knowledgeIds: [],
    });
    expect(findings).toHaveLength(1);
  });
});

describe("detectRepeatedPrompts", () => {
  it(`flags prompts repeated >= ${REPEATED_PROMPT_THRESHOLD} times`, () => {
    const events = makeEvents([
      { ts: "t", event: "prompt-issued", prompt: "which rule?" },
      { ts: "t", event: "prompt-issued", prompt: "Which rule?" },
      { ts: "t", event: "prompt-issued", prompt: "  which rule  " },
    ]);
    const findings = detectRepeatedPrompts(events);
    expect(findings).toHaveLength(1);
    expect(findings[0].recurrence).toBe(3);
    expect(findings[0].confidence).toBe("high");
  });

  it("does not flag at threshold - 1", () => {
    const events = makeEvents([
      { ts: "t", event: "prompt-issued", prompt: "asking once" },
      { ts: "t", event: "prompt-issued", prompt: "asking once" },
    ]);
    expect(detectRepeatedPrompts(events)).toHaveLength(0);
  });
});

describe("detectRuleViolationRecurrence", () => {
  it("emits a finding when prior-run count >= threshold", () => {
    const findings = detectRuleViolationRecurrence(
      [
        {
          ruleId: "BE-PY-001",
          path: "apps/foo.py",
          snippet: "print()",
          priorRunCount: 3,
        },
      ],
      3,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].recurrence).toBe(4); // includes current
  });

  it("respects the threshold", () => {
    const findings = detectRuleViolationRecurrence(
      [
        {
          ruleId: "BE-PY-001",
          path: "apps/foo.py",
          priorRunCount: 1,
        },
      ],
      3,
    );
    expect(findings).toHaveLength(0);
  });

  it("escalates to high confidence at prior-run-count >= 5", () => {
    const findings = detectRuleViolationRecurrence(
      [
        {
          ruleId: "BE-PY-001",
          path: "apps/foo.py",
          priorRunCount: 5,
        },
      ],
      3,
    );
    expect(findings[0].confidence).toBe("high");
  });
});

describe("runDriftDetectors (composition)", () => {
  it("integrates the six detectors and reads cross-session history", () => {
    // Set up two prior session logs with the same ad-hoc step.
    const priorPaths = ["a", "b"].map((salt) => {
      const p = resolveSessionLogPath("tackle-task", { cwd: tmpRoot, salt });
      const w = new SessionEventWriter({ paths: p });
      w.emit({
        ts: "2026-01-01T00:00:00Z",
        event: "workflow-start",
        workflow: "tackle-task",
        "manifest-hash": "x",
      });
      w.emit({
        ts: "2026-01-01T00:00:01Z",
        event: "adhoc-step",
        description: "verify migration guide",
        origin: "user-requested",
      });
      w.emit({
        ts: "2026-01-01T00:00:02Z",
        event: "workflow-completion",
        exit: "pass",
        duration: 1000,
      });
      return p.path;
    });

    // Current run with the same ad-hoc step.
    const currentPaths = resolveSessionLogPath("tackle-task", {
      cwd: tmpRoot,
      salt: "current",
    });
    const writer = new SessionEventWriter({ paths: currentPaths });
    writer.emit({
      ts: "2026-02-01T00:00:00Z",
      event: "workflow-start",
      workflow: "tackle-task",
      "manifest-hash": "y",
    });
    writer.emit({
      ts: "2026-02-01T00:00:01Z",
      event: "step-start",
      step: "research",
    });
    writer.emit({
      ts: "2026-02-01T00:00:02Z",
      event: "adhoc-step",
      description: "verify migration guide",
      origin: "user-requested",
    });
    // Plus a context-gap probe with knowledge unloaded
    writer.emit({
      ts: "2026-02-01T00:00:03Z",
      event: "prompt-issued",
      prompt: "what's the schema change here?",
    });
    writer.emit({
      ts: "2026-02-01T00:00:04Z",
      event: "workflow-completion",
      exit: "pass",
      duration: 4000,
    });

    expect(priorPaths.length).toBe(2);

    const result = runDriftDetectors({
      manifest: MANIFEST,
      sessionLogPath: currentPaths.path,
      cwd: tmpRoot,
    });

    const kinds = result.findings.map((f) => f.kind);
    expect(kinds).toContain("adhoc-step");
    expect(kinds).toContain("context-gap");
    expect(kinds).toContain("skipped-step"); // implement + tests never started

    const adhoc = result.findings.find((f) => f.kind === "adhoc-step");
    expect(adhoc?.recurrence).toBe(3);
    expect(adhoc?.confidence).toBe("high");
    expect(adhoc?.evidence?.length).toBe(2);
  });

  it("sorts findings high → medium → low by confidence", () => {
    const currentPaths = resolveSessionLogPath("tackle-task", {
      cwd: tmpRoot,
      salt: "x",
    });
    const writer = new SessionEventWriter({ paths: currentPaths });
    writer.emit({
      ts: "2026-02-01T00:00:00Z",
      event: "workflow-start",
      workflow: "tackle-task",
      "manifest-hash": "y",
    });
    // ad-hoc step (low confidence; first-occurrence)
    writer.emit({
      ts: "2026-02-01T00:00:01Z",
      event: "adhoc-step",
      description: "one-off",
      origin: "user-requested",
    });
    // repeated prompt (high confidence)
    writer.emit({ ts: "2026-02-01T00:00:02Z", event: "prompt-issued", prompt: "what now" });
    writer.emit({ ts: "2026-02-01T00:00:03Z", event: "prompt-issued", prompt: "what now" });
    writer.emit({ ts: "2026-02-01T00:00:04Z", event: "prompt-issued", prompt: "what now" });

    const result = runDriftDetectors({
      manifest: MANIFEST,
      sessionLogPath: currentPaths.path,
      cwd: tmpRoot,
    });
    const confidences = result.findings.map((f) => f.confidence);
    // Each segment must be monotonically non-increasing in priority
    // (high before medium before low).
    const rank = { high: 0, medium: 1, low: 2 } as const;
    let prev = -1;
    for (const c of confidences) {
      const cur = rank[c];
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});
