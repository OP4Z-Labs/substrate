/**
 * Tests for TI-5 — `substrate scheduler --auto-run`.
 *
 * Verifies:
 *   - Auto-run fires every overdue scheduled workflow
 *   - --workflow filter restricts firing to a single id
 *   - State updates correctly (subsequent --check shows fewer overdue)
 *   - --json emits a structured result envelope
 *   - Empty case (no overdue workflows) handled cleanly
 *   - Workflow failures surface as ok=false but don't crash the loop
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runSchedulerAutoRun,
  runSchedulerCheck,
} from "../src/v2/deterministic/scheduler-command.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function seedScheduledWorkflow(
  cwd: string,
  id: string,
  scheduleClause: string,
  stepRun = "true",
): void {
  const dir = join(cwd, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.yaml`),
    `schema_version: v2.0
id: ${id}
name: ${id}
trigger:
  - schedule:
      ${scheduleClause}
steps:
  - id: noop
    type: invoke-deterministic
    run: "${stepRun}"
`,
  );
}

describe("scheduler --auto-run", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    removeTempDir(tmp);
    logSpy.mockRestore();
    errSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("fires an overdue workflow with an interval schedule (never run before)", async () => {
    seedScheduledWorkflow(tmp, "weekly", "interval: 7d");
    const result = await runSchedulerAutoRun({ cwd: tmp, quiet: true });
    expect(result.fired.length).toBe(1);
    expect(result.fired[0].workflowId).toBe("weekly");
    expect(result.fired[0].ok).toBe(true);
    expect(result.fired[0].exitCode).toBe(0);
  });

  it("subsequent --check reports the workflow as no longer due", async () => {
    seedScheduledWorkflow(tmp, "weekly", "interval: 7d");
    await runSchedulerAutoRun({ cwd: tmp, quiet: true });
    const check = runSchedulerCheck({ cwd: tmp, quiet: true });
    // After firing, the workflow's last-run timestamp is now; it's no
    // longer due. (The scheduler keeps the workflow in `scheduled` but
    // not in `due`.)
    expect(check.due.length).toBe(0);
  });

  it("fires only the named workflow when --workflow filter is set", async () => {
    seedScheduledWorkflow(tmp, "a", "interval: 7d");
    seedScheduledWorkflow(tmp, "b", "interval: 7d");
    const result = await runSchedulerAutoRun({
      cwd: tmp,
      workflowId: "a",
      quiet: true,
    });
    expect(result.fired.length).toBe(1);
    expect(result.fired[0].workflowId).toBe("a");
    // `b` should be in skipped list.
    expect(result.skipped).toContain("b");
  });

  it("returns empty fired list when no workflows are overdue", async () => {
    // No scheduled workflows seeded.
    const result = await runSchedulerAutoRun({ cwd: tmp, quiet: true });
    expect(result.fired.length).toBe(0);
    expect(result.skipped.length).toBe(0);
  });

  it("surfaces failure when the fired workflow's step fails", async () => {
    seedScheduledWorkflow(tmp, "broken", "interval: 7d", "exit 5");
    const result = await runSchedulerAutoRun({ cwd: tmp, quiet: true });
    expect(result.fired.length).toBe(1);
    expect(result.fired[0].workflowId).toBe("broken");
    expect(result.fired[0].ok).toBe(false);
    expect(result.fired[0].exitCode).toBe(1);
  });

  it("--workflow filter on a non-existent workflow reports it as skipped", async () => {
    seedScheduledWorkflow(tmp, "exists", "interval: 7d");
    const result = await runSchedulerAutoRun({
      cwd: tmp,
      workflowId: "nope",
      quiet: true,
    });
    expect(result.fired.length).toBe(0);
    expect(result.skipped).toContain("nope");
    // `exists` (which would be due) is also skipped because the
    // filter excluded it.
    expect(result.skipped).toContain("exists");
  });

  it("--json emits a structured result envelope", async () => {
    seedScheduledWorkflow(tmp, "weekly", "interval: 7d");
    const result = await runSchedulerAutoRun({ cwd: tmp, json: true });
    expect(result.fired.length).toBe(1);
    // JSON written to stdout.
    expect(stdoutSpy).toHaveBeenCalled();
    const payload = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(payload);
    expect(parsed.fired[0].workflowId).toBe("weekly");
  });

  it("fires multiple overdue workflows in one invocation", async () => {
    seedScheduledWorkflow(tmp, "a", "interval: 7d");
    seedScheduledWorkflow(tmp, "b", "interval: 7d");
    seedScheduledWorkflow(tmp, "c", "interval: 7d");
    const result = await runSchedulerAutoRun({ cwd: tmp, quiet: true });
    expect(result.fired.length).toBe(3);
    expect(result.fired.every((f) => f.ok)).toBe(true);
    const ids = result.fired.map((f) => f.workflowId).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
