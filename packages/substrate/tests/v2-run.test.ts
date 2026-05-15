/**
 * Tests for the orchestration-layer `substrate run <workflow>` command.
 *
 * Coverage targets:
 *   - missing workflow → exit 2
 *   - invoke-deterministic step runs and succeeds → exit 0
 *   - invoke-deterministic step fails → exit 1, halts execution
 *   - AI-step type encountered → exit 2 with `deferred` status
 *   - --dry-run skips all step execution but still loads context
 *   - context summary reports standards/rules counts correctly
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runV2Workflow } from "../src/v2/orchestrator/run-command.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function seedWorkflow(
  cwd: string,
  filename: string,
  content: string,
): void {
  const dir = join(cwd, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

describe("runV2Workflow", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    removeTempDir(tmp);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("returns exit 2 when the workflow is not found", async () => {
    seedWorkflow(
      tmp,
      "other.yaml",
      "schema_version: v2.0\nid: other\nname: Other\n",
    );
    const result = await runV2Workflow({
      workflowId: "missing",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("runs an invoke-deterministic step end-to-end (exit 0)", async () => {
    seedWorkflow(
      tmp,
      "echo.yaml",
      `schema_version: v2.0
id: echo
name: Echo
steps:
  - id: say-hi
    type: invoke-deterministic
    run: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "echo",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].status).toBe("ok");
  });

  it("returns exit 1 when an invoke-deterministic step fails", async () => {
    seedWorkflow(
      tmp,
      "fail.yaml",
      `schema_version: v2.0
id: fail
name: Fail
steps:
  - id: first
    type: invoke-deterministic
    run: "true"
  - id: kaboom
    type: invoke-deterministic
    run: "exit 7"
  - id: never-reached
    type: invoke-deterministic
    run: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "fail",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    // Halts on first failure — third step never ran.
    expect(result.steps.length).toBe(2);
    expect(result.steps[1].status).toBe("failed");
  });

  it("defers AI-step types and returns exit 2", async () => {
    seedWorkflow(
      tmp,
      "ai.yaml",
      `schema_version: v2.0
id: ai
name: AI
steps:
  - id: ask
    type: prompt
    prompt: "what do you want?"
`,
    );
    const result = await runV2Workflow({
      workflowId: "ai",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(2);
    expect(result.steps[0].status).toBe("deferred");
    expect(result.steps[0].message).toMatch(/B2/);
  });

  it("--dry-run skips step execution but still loads context", async () => {
    seedWorkflow(
      tmp,
      "dry.yaml",
      `schema_version: v2.0
id: dry
name: Dry
steps:
  - id: would-fail
    type: invoke-deterministic
    run: "exit 99"
`,
    );
    const result = await runV2Workflow({
      workflowId: "dry",
      cwd: tmp,
      quiet: true,
      dryRun: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.steps[0].status).toBe("skipped");
    expect(result.steps[0].message).toBe("dry-run");
  });

  it("dispatches matching workflow-completion hooks", async () => {
    seedWorkflow(
      tmp,
      "hooked.yaml",
      `schema_version: v2.0
id: hooked
name: Hooked
kind: audit
steps:
  - id: noop
    type: invoke-deterministic
    run: "true"
`,
    );
    // Seed a hook that matches kind=audit
    const hookDir = join(tmp, "substrate", "hooks");
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(
      join(hookDir, "after-audit.yaml"),
      `schema_version: v2.0
id: after-audit
trigger: [workflow-completion]
matches:
  workflow-kind: audit
step:
  type: noop
  handler: auto-drift-detect
`,
    );
    const result = await runV2Workflow({
      workflowId: "hooked",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(0);
    const completionHook = result.hookRuns?.find(
      (h) => h.hookId === "after-audit",
    );
    expect(completionHook).toBeDefined();
    // B3: real auto-drift-detect handler now runs. The 1-step workflow
    // executes clean (every manifest step started); zero proposals.
    expect(completionHook!.status).toBe("ok");
    expect(completionHook!.message).toMatch(/no drift detected/);
  });

  it("surfaces composes_findings_of stale-dependency warnings", async () => {
    seedWorkflow(
      tmp,
      "composite.yaml",
      `schema_version: v2.0
id: composite
name: Composite
composes_findings_of:
  - workflow: audit-service
    require-fresh-within: 7d
steps:
  - id: noop
    type: invoke-deterministic
    run: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "composite",
      cwd: tmp,
      quiet: true,
    });
    expect(result.composition).toBeDefined();
    expect(result.composition!.hasStale).toBe(true);
    expect(result.composition!.warnings.length).toBeGreaterThan(0);
  });

  it("reports context summary counts when context is loaded", async () => {
    const stdRoot = join(tmp, "substrate", "standards", "backend");
    mkdirSync(stdRoot, { recursive: true });
    writeFileSync(join(stdRoot, "python.md"), "# Py");
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(
      join(tmp, "substrate", "RULES.yaml"),
      `rules:
  - id: BE-X-001
    title: x
    severity: high
`,
    );
    seedWorkflow(
      tmp,
      "with-context.yaml",
      `schema_version: v2.0
id: with-context
name: With Context
context:
  standards:
    - backend/python.md
  rules:
    - BE-*
steps:
  - id: noop
    type: invoke-deterministic
    run: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "with-context",
      cwd: tmp,
      quiet: true,
    });
    expect(result.contextSummary.standardsLoaded).toBe(1);
    expect(result.contextSummary.rulesMatched).toBe(1);
    expect(result.contextSummary.memoriesLoaded).toBe(0);
  });
});
