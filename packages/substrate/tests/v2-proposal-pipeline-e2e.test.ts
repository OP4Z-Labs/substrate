/**
 * End-to-end test for the proposal pipeline — implements the worked
 * example from plan §7 (ad-hoc migration-guide check).
 *
 * Scenario reconstruction:
 *   1. Three prior runs of `tackle-task` each carry an ad-hoc step
 *      "verify migration guide reflects schema change"
 *   2. A fourth run carries the same ad-hoc step
 *   3. The drift detectors flag it as `adhoc-step` with recurrence=4 → high
 *   4. The classifier produces an `add-to-workflow-step` proposal
 *   5. `runProposalPipeline` writes the pending file
 *   6. The pending file's markdown matches the §7 shape (top-level
 *      heading, per-proposal subheading, recurrence + confidence +
 *      status fields, embedded JSON)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionEventWriter,
  resolveSessionLogPath,
} from "../src/v2/orchestrator/session-log.js";
import {
  parseSessionLogFilename,
  runProposalPipeline,
} from "../src/v2/deterministic/proposals/pipeline.js";
import { listPending } from "../src/v2/deterministic/proposals/queue.js";
import type { WorkflowManifest } from "../src/v2/types.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-pipeline-e2e-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const TACKLE_TASK: WorkflowManifest = {
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

/**
 * Seed a session log with workflow-start + step-start events for each
 * declared step, an adhoc-step, and workflow-completion.
 */
function seedSession(
  cwd: string,
  salt: string,
  startedAt: Date,
  adhocDescription: string,
): string {
  const paths = resolveSessionLogPath(TACKLE_TASK.id, { cwd, salt, startedAt });
  const writer = new SessionEventWriter({ paths });
  writer.emit({
    ts: startedAt.toISOString(),
    event: "workflow-start",
    workflow: TACKLE_TASK.id,
    "manifest-hash": "fixed-hash",
  });
  for (const step of TACKLE_TASK.steps ?? []) {
    writer.emit({
      ts: startedAt.toISOString(),
      event: "step-start",
      step: step.id,
    });
    writer.emit({
      ts: startedAt.toISOString(),
      event: "step-completion",
      step: step.id,
    });
  }
  writer.emit({
    ts: startedAt.toISOString(),
    event: "adhoc-step",
    description: adhocDescription,
    origin: "user-requested",
    "at-step": "implement",
  });
  writer.emit({
    ts: startedAt.toISOString(),
    event: "workflow-completion",
    exit: "pass",
    duration: 1000,
  });
  return paths.path;
}

describe("Proposal pipeline — §7 worked example", () => {
  it("detects + classifies + writes a high-confidence add-to-workflow-step proposal after recurrence", () => {
    // Seed three prior runs with the same ad-hoc check.
    for (let i = 0; i < 3; i += 1) {
      seedSession(
        tmpRoot,
        `prior-${i}`,
        new Date(`2026-05-0${i + 1}T10:00:00Z`),
        "verify migration guide reflects schema change",
      );
    }
    // Current run.
    const currentPath = seedSession(
      tmpRoot,
      "current",
      new Date("2026-05-15T10:00:00Z"),
      "verify migration guide reflects schema change",
    );
    const parsed = parseSessionLogFilename(currentPath);
    expect(parsed).not.toBeNull();
    const shaPrefix = parsed!.shaPrefix;

    const result = runProposalPipeline({
      manifest: TACKLE_TASK,
      sessionLogPath: currentPath,
      shaPrefix,
      cwd: tmpRoot,
      now: new Date("2026-05-15T12:00:00Z"),
    });

    // Drift findings should include the high-confidence ad-hoc step.
    const adhocFindings = result.drifts.filter((d) => d.kind === "adhoc-step");
    expect(adhocFindings).toHaveLength(1);
    expect(adhocFindings[0].recurrence).toBe(4);
    expect(adhocFindings[0].confidence).toBe("high");

    // Proposals should include add-to-workflow-step at high confidence,
    // plus add-to-memory (high confidence piggy-back).
    const kinds = result.proposals.map((p) => p.kind);
    expect(kinds).toContain("add-to-workflow-step");
    expect(kinds).toContain("add-to-memory");
    const wfProposal = result.proposals.find(
      (p) => p.kind === "add-to-workflow-step",
    )!;
    expect(wfProposal.confidence).toBe("high");
    expect(wfProposal.payload).toMatchObject({
      stepType: "prompt",
      mustConfirm: true,
      afterStep: "implement",
    });
  });

  it("writes a pending file whose markdown matches the §7 worked-example shape", () => {
    // Seed three prior + one current as before.
    for (let i = 0; i < 3; i += 1) {
      seedSession(
        tmpRoot,
        `prior-${i}`,
        new Date(`2026-05-0${i + 1}T10:00:00Z`),
        "verify migration guide reflects schema change",
      );
    }
    const currentPath = seedSession(
      tmpRoot,
      "current",
      new Date("2026-05-15T10:00:00Z"),
      "verify migration guide reflects schema change",
    );
    const parsed = parseSessionLogFilename(currentPath);
    const result = runProposalPipeline({
      manifest: TACKLE_TASK,
      sessionLogPath: currentPath,
      shaPrefix: parsed!.shaPrefix,
      cwd: tmpRoot,
      now: new Date("2026-05-15T12:00:00Z"),
    });

    expect(result.pendingPath).not.toBeNull();
    expect(existsSync(result.pendingPath!)).toBe(true);

    const raw = readFileSync(result.pendingPath!, "utf8");

    // Top-level heading per plan §7 example
    expect(raw).toMatch(
      /^# Proposal — tackle-task — 2026-05-15 \([0-9a-f]{8}\)/m,
    );
    // Per-proposal subsection
    expect(raw).toMatch(/## add-to-workflow-step \(confidence: high\)/);
    // Recurrence field
    expect(raw).toMatch(/- \*\*Recurrence:\*\* 4/);
    // Status field
    expect(raw).toMatch(/- \*\*Status:\*\* pending/);
    // Linked sessions field (evidence)
    expect(raw).toMatch(/- \*\*Linked sessions:\*\*/);

    // Walk surfaces it
    const pendingFiles = listPending(tmpRoot);
    expect(pendingFiles).toHaveLength(1);
    expect(pendingFiles[0].proposals.length).toBeGreaterThanOrEqual(1);
    expect(pendingFiles[0].proposals[0].confidence).toBe("high");
  });

  it("inMemoryOnly mode skips the pending file write", () => {
    const currentPath = seedSession(
      tmpRoot,
      "current",
      new Date("2026-05-15T10:00:00Z"),
      "one-off check",
    );
    const parsed = parseSessionLogFilename(currentPath);
    const result = runProposalPipeline({
      manifest: TACKLE_TASK,
      sessionLogPath: currentPath,
      shaPrefix: parsed!.shaPrefix,
      cwd: tmpRoot,
      inMemoryOnly: true,
    });
    expect(result.pendingPath).toBeNull();
    expect(listPending(tmpRoot)).toHaveLength(0);
  });

  it("writes nothing when no drift is detected", () => {
    // Clean run — every step started, no ad-hoc, no prompts.
    const paths = resolveSessionLogPath(TACKLE_TASK.id, {
      cwd: tmpRoot,
      salt: "clean",
    });
    const writer = new SessionEventWriter({ paths });
    writer.emit({
      ts: "2026-05-15T10:00:00Z",
      event: "workflow-start",
      workflow: TACKLE_TASK.id,
      "manifest-hash": "x",
    });
    for (const step of TACKLE_TASK.steps ?? []) {
      writer.emit({ ts: "t", event: "step-start", step: step.id });
      writer.emit({ ts: "t", event: "step-completion", step: step.id });
    }
    writer.emit({
      ts: "2026-05-15T10:00:01Z",
      event: "workflow-completion",
      exit: "pass",
      duration: 1000,
    });
    const parsed = parseSessionLogFilename(paths.path);
    const result = runProposalPipeline({
      manifest: TACKLE_TASK,
      sessionLogPath: paths.path,
      shaPrefix: parsed!.shaPrefix,
      cwd: tmpRoot,
    });
    expect(result.drifts).toHaveLength(0);
    expect(result.proposals).toHaveLength(0);
    expect(result.pendingPath).toBeNull();
    expect(listPending(tmpRoot)).toHaveLength(0);
  });
});
