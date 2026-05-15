/**
 * Tests for the `substrate review --proposals` walker (Phase B3,
 * Primitive 9 Component E).
 *
 * Coverage:
 *   - all 5 controls (accept / reject / edit / defer / skip)
 *   - --dry-run preserves the queue
 *   - --batch-confirm auto-accepts high-confidence + defers the rest
 *   - applicator failures surface as ok=false on the outcome
 *   - empty queue is a clean no-op
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listByStatus,
  listPending,
  parsePendingFile,
  writePendingFile,
} from "../src/v2/deterministic/proposals/queue.js";
import { walkProposals } from "../src/v2/deterministic/proposals/review-command.js";
import type { Proposal } from "../src/v2/deterministic/proposals/types.js";

let tmpRoot: string;
const NOW = new Date("2026-05-15T12:00:00Z");

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-review-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seedWorkflow(yaml: string): void {
  const dir = join(tmpRoot, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tackle-task.yaml"), yaml, "utf8");
}

function makeProposal(over: Partial<Proposal>): Proposal {
  return {
    id: "abc12345abcd",
    workflowId: "tackle-task",
    kind: "add-to-workflow-step",
    confidence: "high",
    suggestedAction: "Add a step.",
    linkedDrift: "adhoc-step",
    status: "pending",
    generatedAt: NOW.toISOString(),
    payload: {
      stepId: "verify",
      stepType: "prompt",
      prompt: "verify",
      mustConfirm: true,
    },
    ...over,
  } as Proposal;
}

function seedPending(proposals: Proposal[], shaPrefix = "deadbeef"): string {
  const r = writePendingFile({
    workflowId: "tackle-task",
    shaPrefix,
    proposals,
    cwd: tmpRoot,
    now: NOW,
  });
  return r.path;
}

describe("walkProposals — accept", () => {
  it("applies the proposal + moves it to applied/", async () => {
    seedWorkflow(`id: tackle-task
name: T
steps:
  - id: research
    type: prompt
`);
    const p = makeProposal({});
    const pendingPath = seedPending([p]);

    const result = await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      decisions: [{ proposalId: p.id, action: "accept" }],
    });
    expect(result.summary.accepted).toBe(1);
    expect(result.outcomes[0].applied?.ok).toBe(true);
    expect(listPending(tmpRoot)).toHaveLength(0);
    expect(existsSync(pendingPath)).toBe(false);
    expect(listByStatus({ cwd: tmpRoot, status: "applied" })).toHaveLength(1);
    const raw = readFileSync(
      join(tmpRoot, "substrate", "workflows", "tackle-task.yaml"),
      "utf8",
    );
    expect(raw).toContain("id: verify");
  });

  it("reports applicator failure without moving the proposal", async () => {
    // No workflow seeded — applicator fails.
    const p = makeProposal({});
    seedPending([p]);
    const result = await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      decisions: [{ proposalId: p.id, action: "accept" }],
    });
    expect(result.outcomes[0].applied?.ok).toBe(false);
    // Proposal stays in pending because the apply failed.
    expect(listPending(tmpRoot)[0].proposals).toHaveLength(1);
  });
});

describe("walkProposals — reject", () => {
  it("moves to rejected/ with a reason", async () => {
    const p = makeProposal({});
    seedPending([p]);
    await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      decisions: [{ proposalId: p.id, action: "reject", reason: "duplicate" }],
    });
    const rejected = listByStatus({ cwd: tmpRoot, status: "rejected" });
    expect(rejected).toHaveLength(1);
    const raw = readFileSync(rejected[0].path, "utf8");
    expect(raw).toContain("- **Reason:** duplicate");
  });
});

describe("walkProposals — edit", () => {
  it("replaces the proposal in pending with the edited version", async () => {
    const p = makeProposal({});
    const pendingPath = seedPending([p]);
    const edited: Proposal = {
      ...p,
      suggestedAction: "edited suggested action",
    };
    await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      decisions: [
        { proposalId: p.id, action: "edit", editedProposal: edited },
      ],
    });
    const reparsed = parsePendingFile(pendingPath);
    expect(reparsed.proposals[0].suggestedAction).toBe("edited suggested action");
  });

  it("no-ops when edit decision has no editedProposal", async () => {
    const p = makeProposal({});
    seedPending([p]);
    const result = await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      decisions: [{ proposalId: p.id, action: "edit" }],
    });
    expect(result.outcomes[0].message).toMatch(/no editedProposal/);
  });
});

describe("walkProposals — defer", () => {
  it("keeps the proposal in pending and flips status to deferred", async () => {
    const p = makeProposal({});
    const pendingPath = seedPending([p]);
    await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      decisions: [{ proposalId: p.id, action: "defer" }],
    });
    const parsed = parsePendingFile(pendingPath);
    expect(parsed.proposals[0].status).toBe("deferred");
  });
});

describe("walkProposals — skip", () => {
  it("leaves the proposal in pending unchanged", async () => {
    const p = makeProposal({});
    const pendingPath = seedPending([p]);
    await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      decisions: [{ proposalId: p.id, action: "skip" }],
    });
    const parsed = parsePendingFile(pendingPath);
    expect(parsed.proposals[0].status).toBe("pending");
  });

  it("is the default when no decision is supplied", async () => {
    const p = makeProposal({});
    seedPending([p]);
    const result = await walkProposals({ cwd: tmpRoot, quiet: true });
    expect(result.summary.skipped).toBe(1);
  });
});

describe("walkProposals — --dry-run", () => {
  it("does not write files or move proposals", async () => {
    seedWorkflow(`id: tackle-task
name: T
steps:
  - id: a
    type: prompt
`);
    const p = makeProposal({});
    seedPending([p]);
    await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      dryRun: true,
      decisions: [{ proposalId: p.id, action: "accept" }],
    });
    // Pending file still there
    expect(listPending(tmpRoot)).toHaveLength(1);
    expect(listByStatus({ cwd: tmpRoot, status: "applied" })).toHaveLength(0);
    // Workflow file untouched
    const raw = readFileSync(
      join(tmpRoot, "substrate", "workflows", "tackle-task.yaml"),
      "utf8",
    );
    expect(raw).not.toContain("id: verify");
  });
});

describe("walkProposals — --batch-confirm", () => {
  it("auto-accepts high-confidence + defers the rest", async () => {
    seedWorkflow(`id: tackle-task
name: T
steps:
  - id: a
    type: prompt
`);
    const high = makeProposal({ id: "highhighhigh", confidence: "high" });
    const med = makeProposal({
      id: "medmedmedmed",
      confidence: "medium",
      payload: {
        stepId: "another",
        stepType: "prompt",
        prompt: "x",
        mustConfirm: true,
      },
    } as Partial<Proposal>);
    seedPending([high, med]);

    const result = await walkProposals({
      cwd: tmpRoot,
      quiet: true,
      batchConfirm: true,
    });
    expect(result.summary.accepted).toBe(1);
    expect(result.summary.deferred).toBe(1);
  });
});

describe("walkProposals — empty queue", () => {
  it("returns a clean no-op when there are no pending files", async () => {
    const result = await walkProposals({ cwd: tmpRoot, quiet: true });
    expect(result.summary.total).toBe(0);
    expect(result.outcomes).toHaveLength(0);
  });
});
