/**
 * Tests for the eight proposal applicators (Phase B3, Primitive 9
 * Component E).
 *
 * Each applicator writes a specific file shape. Tests verify:
 *   - the file is written to the right path
 *   - the contents parse correctly via the right schema/parser
 *   - comments + structure in source files are preserved (workflow YAML, RULES.yaml)
 *   - dry-run mode skips the write but still returns the preview
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
import { parse as parseYaml } from "yaml";
import { applyProposal } from "../src/v2/deterministic/proposals/applicators.js";
import type { Proposal } from "../src/v2/deterministic/proposals/types.js";

let tmpRoot: string;

const NOW = new Date("2026-05-15T12:00:00Z");

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-applicators-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seedWorkflow(yaml: string): string {
  const dir = join(tmpRoot, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "tackle-task.yaml");
  writeFileSync(path, yaml, "utf8");
  return path;
}

function seedRules(yaml: string): string {
  const dir = join(tmpRoot, "substrate");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "RULES.yaml");
  writeFileSync(path, yaml, "utf8");
  return path;
}

const sampleProposal = <P extends Proposal>(over: Partial<P>): P =>
  ({
    id: "abc123",
    workflowId: "tackle-task",
    confidence: "high",
    suggestedAction: "Test action.",
    linkedDrift: "adhoc-step",
    status: "pending",
    generatedAt: NOW.toISOString(),
    ...over,
  }) as P;

describe("applyProposal — add-to-workflow-step", () => {
  it("inserts a new step after the anchor and preserves comments", () => {
    seedWorkflow(`schema_version: v2.0
id: tackle-task
name: Tackle task
steps:
  # research first
  - id: research
    type: prompt
  - id: implement   # the doing
    type: prompt
  - id: tests
    type: prompt
`);
    const p = sampleProposal({
      kind: "add-to-workflow-step",
      payload: {
        stepId: "verify-changelog",
        stepName: "verify CHANGELOG",
        stepType: "prompt",
        prompt: "verify the CHANGELOG was updated",
        mustConfirm: true,
        afterStep: "implement",
      },
    } as Partial<Proposal>);
    const result = applyProposal(p, { cwd: tmpRoot });
    expect(result.ok).toBe(true);
    expect(result.writes).toHaveLength(1);
    const raw = readFileSync(
      join(tmpRoot, "substrate", "workflows", "tackle-task.yaml"),
      "utf8",
    );
    expect(raw).toContain("# research first");
    expect(raw).toContain("# the doing");
    const parsed = parseYaml(raw) as { steps: Array<{ id: string }> };
    expect(parsed.steps.map((s) => s.id)).toEqual([
      "research",
      "implement",
      "verify-changelog",
      "tests",
    ]);
  });

  it("returns ok=false when the workflow manifest is missing", () => {
    const p = sampleProposal({
      kind: "add-to-workflow-step",
      payload: { stepId: "x", stepType: "prompt", prompt: "y" },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not found/);
  });

  it("dry-run returns the preview without writing", () => {
    seedWorkflow(`id: tackle-task\nname: T\nsteps:\n  - id: a\n    type: prompt\n`);
    const p = sampleProposal({
      kind: "add-to-workflow-step",
      payload: { stepId: "b", stepType: "prompt", prompt: "x" },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.writes[0].preview).toContain("id: b");
    const raw = readFileSync(
      join(tmpRoot, "substrate", "workflows", "tackle-task.yaml"),
      "utf8",
    );
    expect(raw).not.toContain("id: b"); // not written
  });

  // Regression test for SMOKE-2026-05-15 finding 9: the applicator's
  // inserted step used `id → type → name → run` while existing steps
  // used `id → name → type → run`. The schema doesn't care but the
  // diff is noisy. The fix emits the canonical key order.
  it("emits the inserted step with the canonical key order (id → name → type → run)", () => {
    seedWorkflow(`schema_version: v2.0
id: tackle-task
name: w
steps:
  - id: a
    name: step a
    type: prompt
    prompt: a-prompt
`);
    const p = sampleProposal({
      kind: "add-to-workflow-step",
      payload: {
        stepId: "service-validation",
        stepName: "Rebuild and restart services",
        stepType: "invoke-deterministic",
        run: "docker compose restart",
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok, `apply failed: ${r.message}`).toBe(true);
    const raw = readFileSync(
      join(tmpRoot, "substrate", "workflows", "tackle-task.yaml"),
      "utf8",
    );
    // The inserted block must list id → name → type → run in that order.
    // We capture the inserted step's lines and assert positions.
    const idLine = raw.indexOf("- id: service-validation");
    const nameLine = raw.indexOf("name: Rebuild and restart services");
    const typeLine = raw.indexOf("type: invoke-deterministic");
    const runLine = raw.indexOf("run: docker compose restart");
    expect(idLine).toBeGreaterThan(-1);
    expect(nameLine).toBeGreaterThan(idLine);
    expect(typeLine).toBeGreaterThan(nameLine);
    expect(runLine).toBeGreaterThan(typeLine);
  });
});

describe("applyProposal — add-to-memory", () => {
  it("writes a memory file with extended frontmatter under the override memory dir", () => {
    const memDir = join(tmpRoot, "memstore");
    mkdirSync(memDir, { recursive: true });
    const p = sampleProposal({
      kind: "add-to-memory",
      payload: {
        name: "feedback-verify-changelog",
        type: "feedback",
        scope: "task-tackle",
        tags: ["tackle-task", "drift-derived"],
        body: "When implementing schema changes, always verify the CHANGELOG reflects the change.",
        description: "Auto-captured by substrate drift detection.",
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot, memoryPath: memDir });
    expect(r.ok).toBe(true);
    const path = join(memDir, "feedback-verify-changelog.md");
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(raw).toMatch(/^---/);
    expect(raw).toMatch(/name: feedback-verify-changelog/);
    expect(raw).toMatch(/metadata:[\s\S]+type: feedback/);
  });

  it("fails when no memory store is discoverable", () => {
    const p = sampleProposal({
      kind: "add-to-memory",
      payload: {
        name: "n",
        type: "feedback",
        body: "x",
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, {
      cwd: tmpRoot,
      homeDir: join(tmpRoot, "nope"),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no memory store/);
  });
});

describe("applyProposal — add-to-rule", () => {
  it("appends a rule to RULES.yaml with manual-review: true", () => {
    seedRules(`# RULES registry
rules:
  - id: BE-PY-001
    title: Existing rule
    severity: high
`);
    const p = sampleProposal({
      kind: "add-to-rule",
      payload: {
        ruleId: "BE-PY-001-followup",
        title: "Recurring violation",
        description: "Strengthen BE-PY-001.",
        severity: "medium",
        manualReview: true,
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok).toBe(true);
    const raw = readFileSync(join(tmpRoot, "substrate", "RULES.yaml"), "utf8");
    expect(raw).toContain("# RULES registry");
    expect(raw).toContain("id: BE-PY-001-followup");
    expect(raw).toContain("manual-review: true");
    const parsed = parseYaml(raw) as { rules: Array<{ id: string }> };
    expect(parsed.rules.map((r) => r.id)).toEqual([
      "BE-PY-001",
      "BE-PY-001-followup",
    ]);
  });
});

describe("applyProposal — add-to-standards-doc", () => {
  it("creates the standards doc when it doesn't exist", () => {
    mkdirSync(join(tmpRoot, "substrate", "standards"), { recursive: true });
    const p = sampleProposal({
      kind: "add-to-standards-doc",
      payload: {
        docPath: "workflows/tackle-task.md",
        sectionHeading: "Execution notes",
        addition: "Steps execute strictly in declared order.",
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok).toBe(true);
    const path = join(
      tmpRoot,
      "substrate",
      "standards",
      "workflows",
      "tackle-task.md",
    );
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("## Execution notes");
    expect(raw).toContain("Steps execute strictly in declared order.");
    expect(raw).toContain("<!-- substrate-proposal:");
  });

  it("appends under an existing heading without duplicating it", () => {
    mkdirSync(join(tmpRoot, "substrate", "standards", "workflows"), {
      recursive: true,
    });
    writeFileSync(
      join(tmpRoot, "substrate", "standards", "workflows", "tackle-task.md"),
      "# tackle-task\n\n## Execution notes\n\nExisting note.\n",
      "utf8",
    );
    const p = sampleProposal({
      kind: "add-to-standards-doc",
      payload: {
        docPath: "workflows/tackle-task.md",
        sectionHeading: "Execution notes",
        addition: "Added by proposal pipeline.",
      },
    } as Partial<Proposal>);
    applyProposal(p, { cwd: tmpRoot });
    const raw = readFileSync(
      join(tmpRoot, "substrate", "standards", "workflows", "tackle-task.md"),
      "utf8",
    );
    expect(raw.match(/## Execution notes/g)).toHaveLength(1);
    expect(raw).toContain("Existing note.");
    expect(raw).toContain("Added by proposal pipeline.");
  });
});

describe("applyProposal — add-to-adr", () => {
  it("creates DEC-001-<slug>.md when no prior ADRs exist", () => {
    const p = sampleProposal({
      kind: "add-to-adr",
      payload: {
        slug: "drift-derived-decision",
        title: "Drift-derived decision",
        body: "We chose X because Y.",
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok).toBe(true);
    expect(r.writes[0].path).toMatch(/DEC-001-drift-derived-decision\.md$/);
    const raw = readFileSync(r.writes[0].path, "utf8");
    expect(raw).toMatch(/^# DEC-001:/);
    expect(raw).toContain("- **Status:** proposed");
  });

  it("auto-increments to DEC-002 when DEC-001 already exists", () => {
    const dir = join(tmpRoot, "auto", "docs", "decisions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "DEC-001-original.md"), "# DEC-001", "utf8");
    const p = sampleProposal({
      kind: "add-to-adr",
      payload: { slug: "second", title: "Second", body: "..." },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.writes[0].path).toMatch(/DEC-002-second\.md$/);
  });
});

describe("applyProposal — add-to-doc-check-registry", () => {
  it("writes a doc-check YAML the v2 doc-check schema can parse", () => {
    const p = sampleProposal({
      kind: "add-to-doc-check-registry",
      payload: {
        docCheckId: "migration-on-schema-change",
        description: "Verify migration guide on schema change",
        triggerGlob: "**/schemas/**",
        requireDoc: "docs/MIGRATION.md",
        severity: "should-fix",
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok).toBe(true);
    const raw = readFileSync(
      join(tmpRoot, "substrate", "doc-checks", "migration-on-schema-change.yaml"),
      "utf8",
    );
    const parsed = parseYaml(raw) as {
      id: string;
      when: { "files-changed-any": string[] };
    };
    expect(parsed.id).toBe("migration-on-schema-change");
    expect(parsed.when["files-changed-any"]).toEqual(["**/schemas/**"]);
  });
});

describe("applyProposal — strengthen-context-load", () => {
  it("appends to context.standards", () => {
    seedWorkflow(`id: tackle-task
name: T
context:
  standards:
    - backend/architecture.md
steps:
  - id: a
    type: prompt
`);
    const p = sampleProposal({
      kind: "strengthen-context-load",
      payload: {
        contextKind: "standards",
        additions: ["backend/python.md"],
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok).toBe(true);
    const raw = readFileSync(
      join(tmpRoot, "substrate", "workflows", "tackle-task.yaml"),
      "utf8",
    );
    const parsed = parseYaml(raw) as { context: { standards: string[] } };
    expect(parsed.context.standards).toEqual([
      "backend/architecture.md",
      "backend/python.md",
    ]);
  });

  it("collects warnings when context key is missing", () => {
    seedWorkflow(`id: tackle-task
name: T
steps:
  - id: a
    type: prompt
`);
    const p = sampleProposal({
      kind: "strengthen-context-load",
      payload: {
        contextKind: "standards",
        additions: ["x.md"],
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok).toBe(false);
    expect(r.warnings && r.warnings.length).toBeGreaterThan(0);
  });
});

describe("applyProposal — cross-link-existing", () => {
  it("appends a See-also link to the source file", () => {
    mkdirSync(join(tmpRoot, "substrate", "workflows"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "substrate", "workflows", "tackle-task.body.md"),
      "# Tackle task\n\nDo the thing.\n",
      "utf8",
    );
    const p = sampleProposal({
      kind: "cross-link-existing",
      payload: {
        sourcePath: "substrate/workflows/tackle-task.body.md",
        targetPath: "CHANGELOG.md",
        anchor: "CHANGELOG.md",
      },
    } as Partial<Proposal>);
    const r = applyProposal(p, { cwd: tmpRoot });
    expect(r.ok).toBe(true);
    const raw = readFileSync(
      join(tmpRoot, "substrate", "workflows", "tackle-task.body.md"),
      "utf8",
    );
    expect(raw).toContain("See also: [CHANGELOG.md](CHANGELOG.md)");
    expect(raw).toContain("<!-- substrate-cross-link:");
  });
});
