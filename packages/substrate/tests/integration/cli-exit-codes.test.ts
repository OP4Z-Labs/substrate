/**
 * CLI exit-code regression tests for SMOKE-2026-05-15 findings 2, 7, 10, 11.
 *
 * Several v2 commands reported failure in human output but exited 0,
 * which broke CI gating. The unit suite couldn't catch this — exit-code
 * propagation depends on how commander.js + main()'s error handler
 * interact, which only the spawned binary exercises end-to-end.
 *
 * Each test below maps to one of the smoke-report findings:
 *
 *   - audit / audit --json with no RULES.yaml → exit 1
 *   - audit --json on missing RULES emits a JSON envelope (not human text)
 *   - validate on empty workflows dir → exit 2
 *   - doctor with at least one error severity → exit 1
 *   - knowledge show with no KNOWLEDGE.md → exit 1
 *   - hooks describe <nonexistent> → exit 1
 *   - run with no workflow-id → exit 1 (commander missing-required-arg)
 *
 * These are lock-in regression tests — they would have caught the smoke
 * findings before publish if they had existed at the time.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

describe("substrate CLI exit codes (regression for SMOKE-2026-05-15)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpDir();
  });
  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("audit on fresh dir (no RULES.yaml) exits non-zero", () => {
    const result = runCli(["audit"], { cwd: tmp });
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
      .not.toBe(0);
    expect(result.stderr).toContain("no RULES.yaml");
  });

  it("audit --json on fresh dir emits a JSON error envelope and exits non-zero", () => {
    const result = runCli(["audit", "--json"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    // Stdout must be a parseable JSON document — that's the entire
    // point of `--json`. The previous bug emitted human-formatted text
    // on stderr and an empty stdout for this path.
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string; message: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("rules-not-found");
    expect(parsed.error?.message).toContain("no RULES.yaml");
  });

  it("validate on a dir with no substrate/workflows/ exits 2", () => {
    const result = runCli(["validate"], { cwd: tmp });
    expect(result.status).toBe(2);
  });

  it("doctor with a missing config + no auto dir exits non-zero (has errors)", () => {
    const result = runCli(["doctor"], { cwd: tmp });
    expect(result.status, `output: ${result.output}`).not.toBe(0);
  });

  it("knowledge show without a KNOWLEDGE.md exits non-zero", () => {
    const result = runCli(["knowledge", "show"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("KNOWLEDGE.md not found");
  });

  it("hooks describe <nonexistent> exits non-zero", () => {
    // First init the v2 layout so the hooks dir exists with valid manifests;
    // then ask describe for an id that doesn't appear in the registry.
    runCli(["init", "--quiet"], { cwd: tmp });
    const result = runCli(["hooks", "describe", "definitely-not-a-real-hook"], {
      cwd: tmp,
    });
    expect(result.status, `output: ${result.output}`).not.toBe(0);
    expect(result.output).toContain("not found");
  });

  it("run with no workflow-id exits non-zero (missing required argument)", () => {
    const result = runCli(["run"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    // commander.js prints "error: missing required argument 'workflow-id'".
    expect(result.stderr.toLowerCase()).toContain("workflow-id");
  });

  it("scheduler with no --check flag exits 2 (usage error)", () => {
    const result = runCli(["scheduler"], { cwd: tmp });
    expect(result.status).toBe(2);
  });

  it("review with no --proposals flag exits 2 (usage error)", () => {
    const result = runCli(["review"], { cwd: tmp });
    expect(result.status).toBe(2);
  });
});
