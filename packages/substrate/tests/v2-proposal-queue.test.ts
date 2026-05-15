/**
 * Tests for the proposal queue I/O (Phase B3, Primitive 9 Component D).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deferProposal,
  ensureQueueLayout,
  listByStatus,
  listPending,
  moveProposal,
  parsePendingFile,
  queueStats,
  renderPendingFile,
  resolveQueueLayout,
  updatePendingProposal,
  writePendingFile,
} from "../src/v2/deterministic/proposals/queue.js";
import type { Proposal } from "../src/v2/deterministic/proposals/types.js";

let tmpRoot: string;

const NOW = new Date("2026-05-15T12:00:00Z");

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-queue-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function sampleProposal(id: string, overrides: Partial<Proposal> = {}): Proposal {
  return {
    id,
    workflowId: "tackle-task",
    kind: "add-to-workflow-step",
    confidence: "high",
    suggestedAction: "Add a permanent step.",
    linkedDrift: "adhoc-step",
    status: "pending",
    generatedAt: NOW.toISOString(),
    payload: {
      stepId: "new-step",
      stepType: "prompt",
      prompt: "do the new thing",
      mustConfirm: true,
    },
    ...overrides,
  } as Proposal;
}

describe("resolveQueueLayout / ensureQueueLayout", () => {
  it("creates pending/applied/rejected dirs", () => {
    const layout = ensureQueueLayout(tmpRoot);
    expect(existsSync(layout.pendingDir)).toBe(true);
    expect(existsSync(layout.appliedDir)).toBe(true);
    expect(existsSync(layout.rejectedDir)).toBe(true);
  });
});

describe("writePendingFile + parsePendingFile", () => {
  it("writes a file named <date>-<workflow>-<sha>.md", () => {
    const r = writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "abc12345",
      proposals: [sampleProposal("aaa111bbb222")],
      cwd: tmpRoot,
      now: NOW,
    });
    expect(r.filename).toBe("2026-05-15-tackle-task-abc12345.md");
    expect(existsSync(r.path)).toBe(true);
  });

  it("round-trips proposals losslessly", () => {
    const proposals = [
      sampleProposal("aaa111bbb222"),
      sampleProposal("ccc333ddd444", {
        kind: "strengthen-context-load",
        confidence: "medium",
        payload: { contextKind: "memory", additions: ["one", "two"] },
      } as Partial<Proposal>),
    ];
    const r = writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "deadbeef",
      proposals,
      cwd: tmpRoot,
      now: NOW,
    });
    const parsed = parsePendingFile(r.path);
    expect(parsed.proposals).toHaveLength(2);
    expect(parsed.proposals.map((p) => p.id)).toEqual([
      "aaa111bbb222",
      "ccc333ddd444",
    ]);
    expect(parsed.workflowId).toBe("tackle-task");
    expect(parsed.shaPrefix).toBe("deadbeef");
    expect(parsed.date).toBe("2026-05-15");
  });

  it("renders the worked-example-shaped markdown", () => {
    const r = writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "abc12345",
      proposals: [sampleProposal("aaa111bbb222", { recurrence: 3, evidence: ["a.jsonl", "b.jsonl"] })],
      cwd: tmpRoot,
      now: NOW,
    });
    const raw = readFileSync(r.path, "utf8");
    expect(raw).toContain("# Proposal — tackle-task — 2026-05-15 (abc12345)");
    expect(raw).toContain("## add-to-workflow-step (confidence: high)");
    expect(raw).toContain("- **Recurrence:** 3");
    expect(raw).toContain("- **Linked sessions:**");
    expect(raw).toContain("```json");
  });
});

describe("listPending", () => {
  it("returns pending files sorted by date asc", () => {
    writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "11111111",
      proposals: [sampleProposal("a")],
      cwd: tmpRoot,
      now: new Date("2026-05-10T00:00:00Z"),
    });
    writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "22222222",
      proposals: [sampleProposal("b")],
      cwd: tmpRoot,
      now: new Date("2026-05-15T00:00:00Z"),
    });
    const pending = listPending(tmpRoot);
    expect(pending).toHaveLength(2);
    expect(pending[0].date).toBe("2026-05-10");
    expect(pending[1].date).toBe("2026-05-15");
  });

  it("returns empty array when pending dir is missing", () => {
    expect(listPending(tmpRoot)).toEqual([]);
  });
});

describe("moveProposal", () => {
  it("moves a single proposal to applied/ and rewrites pending", () => {
    const proposals = [sampleProposal("aaa"), sampleProposal("bbb")];
    const r = writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "deadbeef",
      proposals,
      cwd: tmpRoot,
      now: NOW,
    });
    const moveResult = moveProposal({
      cwd: tmpRoot,
      fromPath: r.path,
      proposal: proposals[0],
      toStatus: "applied",
      now: NOW,
    });
    expect(existsSync(moveResult.destPath)).toBe(true);
    expect(moveResult.pendingFileRemoved).toBe(false);
    expect(moveResult.remaining).toBe(1);
    const parsed = parsePendingFile(r.path);
    expect(parsed.proposals.map((p) => p.id)).toEqual(["bbb"]);
    const applied = listByStatus({ cwd: tmpRoot, status: "applied" });
    expect(applied).toHaveLength(1);
    expect(applied[0].proposals[0].status).toBe("applied");
  });

  it("removes the pending file when the last proposal is moved", () => {
    const proposals = [sampleProposal("only")];
    const r = writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "abc12345",
      proposals,
      cwd: tmpRoot,
      now: NOW,
    });
    const result = moveProposal({
      cwd: tmpRoot,
      fromPath: r.path,
      proposal: proposals[0],
      toStatus: "rejected",
      reason: "duplicate",
      now: NOW,
    });
    expect(result.pendingFileRemoved).toBe(true);
    expect(existsSync(r.path)).toBe(false);
    const rejected = listByStatus({ cwd: tmpRoot, status: "rejected" });
    expect(rejected).toHaveLength(1);
    const raw = readFileSync(rejected[0].path, "utf8");
    expect(raw).toContain("- **Reason:** duplicate");
  });
});

describe("deferProposal", () => {
  it("flips a proposal status to deferred without moving its file", () => {
    const proposals = [sampleProposal("only")];
    const r = writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "deadbeef",
      proposals,
      cwd: tmpRoot,
      now: NOW,
    });
    const ok = deferProposal({ pendingPath: r.path, proposalId: "only" });
    expect(ok).toBe(true);
    const parsed = parsePendingFile(r.path);
    expect(parsed.proposals[0].status).toBe("deferred");
  });

  it("returns false when the proposal id is missing", () => {
    const proposals = [sampleProposal("only")];
    const r = writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "abc12345",
      proposals,
      cwd: tmpRoot,
      now: NOW,
    });
    expect(deferProposal({ pendingPath: r.path, proposalId: "missing" })).toBe(false);
  });
});

describe("updatePendingProposal", () => {
  it("replaces a proposal with an edited copy", () => {
    const proposals = [sampleProposal("aaa")];
    const r = writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "abc12345",
      proposals,
      cwd: tmpRoot,
      now: NOW,
    });
    const edited = { ...proposals[0], suggestedAction: "edited action" } as Proposal;
    updatePendingProposal({ pendingPath: r.path, updated: edited });
    const parsed = parsePendingFile(r.path);
    expect(parsed.proposals[0].suggestedAction).toBe("edited action");
  });
});

describe("queueStats", () => {
  it("counts pending + applied + rejected proposals", () => {
    const proposals = [
      sampleProposal("a"),
      sampleProposal("b", { kind: "add-to-memory" } as Partial<Proposal>),
    ];
    writePendingFile({
      workflowId: "tackle-task",
      shaPrefix: "11111111",
      proposals,
      cwd: tmpRoot,
      now: NOW,
    });
    const stats = queueStats(tmpRoot);
    expect(stats.pendingProposals).toBe(2);
    expect(stats.byKind["add-to-workflow-step"]).toBe(1);
    expect(stats.byKind["add-to-memory"]).toBe(1);
  });
});

describe("renderPendingFile — empty queue", () => {
  it("renders a sentinel placeholder when there are no proposals", () => {
    const body = renderPendingFile("tackle-task", "abc12345", []);
    expect(body).toContain("_No drift detected");
  });
});

describe("resolveQueueLayout", () => {
  it("returns absolute paths under substrate/proposals/", () => {
    const layout = resolveQueueLayout(tmpRoot);
    expect(layout.root).toBe(join(tmpRoot, "substrate", "proposals"));
    expect(layout.pendingDir).toBe(join(layout.root, "pending"));
  });
});
