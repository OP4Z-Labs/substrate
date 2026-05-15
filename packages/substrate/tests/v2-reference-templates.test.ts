/**
 * End-to-end validation for the three reference workflow templates
 * shipped in `templates/workflows/`:
 *   - audit-service
 *   - audit-package
 *   - tackle-task
 *
 * Per the B1 acceptance criteria:
 *   - `substrate validate templates/workflows/<id>.yaml` returns
 *     exit 0
 *   - `substrate run <id>` can dispatch the workflow (B1 only
 *     fully executes invoke-deterministic steps; AI-step types
 *     surface deferred).
 *
 * The fixture pattern: copy the three templates into a tmp repo's
 * `substrate/workflows/` directory and invoke the v2 commands
 * against that cwd.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runValidate } from "../src/v2/deterministic/validate-command.js";
import { runV2Workflow } from "../src/v2/orchestrator/run-command.js";
import { discoverWorkflows } from "../src/v2/discoverer.js";
import { getTemplatesDir } from "../src/util/paths.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

/**
 * Copy only the v2 reference templates (and their bodies) into the
 * target's substrate/workflows/ directory. We deliberately exclude
 * the legacy v0.5 `new-service.yaml` template, which predates the v2
 * schema and is preserved for backwards-compat tests in
 * `tests/workflow.test.ts`.
 */
function seedTemplates(targetRoot: string): string[] {
  const templatesDir = join(getTemplatesDir(), "workflows");
  const dest = join(targetRoot, "substrate", "workflows");
  mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(templatesDir)) {
    const isReferenceManifest = REFERENCE_IDS.some(
      (id) => name === `${id}.yaml` || name === `${id}.body.md`,
    );
    if (!isReferenceManifest) continue;
    copyFileSync(join(templatesDir, name), join(dest, name));
    copied.push(name);
  }
  return copied;
}

const REFERENCE_IDS = [
  "audit-service",
  "audit-package",
  "tackle-task",
  "audit-composite",
];

describe("reference workflow templates", () => {
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

  it("ships all three reference manifests + bodies", () => {
    const templatesDir = join(getTemplatesDir(), "workflows");
    for (const id of REFERENCE_IDS) {
      expect(
        existsSync(join(templatesDir, `${id}.yaml`)),
        `${id}.yaml should ship under templates/workflows/`,
      ).toBe(true);
      expect(
        existsSync(join(templatesDir, `${id}.body.md`)),
        `${id}.body.md should ship alongside the manifest`,
      ).toBe(true);
    }
  });

  it("validates against the schema (substrate validate returns 0)", () => {
    seedTemplates(tmp);
    const result = runValidate({ cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(REFERENCE_IDS.length);
  });

  it("Discoverer registers all three reference workflows", () => {
    seedTemplates(tmp);
    const discovery = discoverWorkflows({ cwd: tmp });
    const ids = discovery.workflows.map((w) => w.manifest.id);
    for (const id of REFERENCE_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("loads body.md siblings for each reference workflow", () => {
    seedTemplates(tmp);
    const discovery = discoverWorkflows({ cwd: tmp });
    for (const id of REFERENCE_IDS) {
      const wf = discovery.workflows.find((w) => w.manifest.id === id);
      expect(wf, `workflow ${id} should be discovered`).toBeDefined();
      expect(wf?.body, `${id} should have a non-null body`).not.toBeNull();
      expect(wf?.body?.length).toBeGreaterThan(100);
    }
  });

  describe("substrate run <reference-workflow>", () => {
    it("audit-service: executes invoke-deterministic detector pass (may exit 1 if substrate CLI not on PATH; this verifies dispatch reached the step)", async () => {
      seedTemplates(tmp);
      const result = await runV2Workflow({
        workflowId: "audit-service",
        cwd: tmp,
        quiet: true,
      });
      // The run step shells `substrate audit --json`. In the test
      // env the global `substrate` binary likely isn't installed, so
      // the step exits non-zero. What matters for B1 is that
      // dispatch reached the deterministic step — confirmed by the
      // step record's presence.
      expect(result.steps.length).toBeGreaterThanOrEqual(1);
      expect(result.steps[0].stepId).toBe("run-detector");
      expect(["ok", "failed"]).toContain(result.steps[0].status);
    });

    it("audit-package: executes invoke-deterministic detector pass", async () => {
      seedTemplates(tmp);
      const result = await runV2Workflow({
        workflowId: "audit-package",
        cwd: tmp,
        quiet: true,
      });
      expect(result.steps.length).toBeGreaterThanOrEqual(1);
      expect(result.steps[0].stepId).toBe("run-detector");
    });

    it("audit-service --dry-run skips the detector but still returns 0", async () => {
      seedTemplates(tmp);
      const result = await runV2Workflow({
        workflowId: "audit-service",
        cwd: tmp,
        quiet: true,
        dryRun: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.ok).toBe(true);
      expect(result.steps[0].status).toBe("skipped");
    });

    it("tackle-task halts at the first prompt step (B2-deferred)", async () => {
      seedTemplates(tmp);
      const result = await runV2Workflow({
        workflowId: "tackle-task",
        cwd: tmp,
        quiet: true,
      });
      // tackle-task[0] is `research` (type: prompt) — must surface
      // deferred and exit 2.
      expect(result.exitCode).toBe(2);
      expect(result.steps[0].stepId).toBe("research");
      expect(result.steps[0].status).toBe("deferred");
      expect(result.steps[0].message).toMatch(/B2/);
    });

    it("tackle-task --dry-run walks every step as skipped", async () => {
      seedTemplates(tmp);
      const result = await runV2Workflow({
        workflowId: "tackle-task",
        cwd: tmp,
        quiet: true,
        dryRun: true,
      });
      expect(result.exitCode).toBe(0);
      // Steps fully walk during dry-run, even ones that would
      // otherwise be deferred.
      expect(result.steps.length).toBe(8);
      expect(result.steps.every((s) => s.status === "skipped")).toBe(true);
    });
  });
});
