/**
 * Integration coverage for `cadence workflow` (v0.5).
 *
 * Exercises the spawned CLI binary across list / describe / start.
 * The interactive prompt flow is hard to drive from a subprocess
 * without a TTY, so prompt-based scenarios stay in the unit suite
 * (which uses the `resolvePrompt` test seam). Integration tests
 * focus on:
 *
 *   - workflow list (with and without registered workflows)
 *   - workflow describe (positive + unknown-id)
 *   - workflow start with --var (no prompts), command-only steps
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

describe("cadence workflow (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    const init = runCli(
      ["init", "--name", "wf-int", "--short-code", "WI", "--quiet"],
      { cwd: tmp },
    );
    if (init.status !== 0) {
      throw new Error(`init failed: ${init.stderr}`);
    }
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("workflow list with no registered workflows reports the empty state", () => {
    const result = runCli(["workflow", "list"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/No workflows registered/i);
    expect(result.stdout).toMatch(/cadence add workflow/);
  });

  it("workflow list shows the bundled new-service workflow after `add workflow`", () => {
    runCli(["add", "workflow", "new-service", "--quiet"], { cwd: tmp });
    const result = runCli(["workflow", "list"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("new-service");
    expect(result.stdout).toMatch(/step\(s\)/);
  });

  it("workflow list --json emits an array of workflow definitions", () => {
    runCli(["add", "workflow", "new-service", "--quiet"], { cwd: tmp });
    const result = runCli(["workflow", "list", "--json"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBe(1);
    expect(payload[0].id).toBe("new-service");
    expect(Array.isArray(payload[0].steps)).toBe(true);
  });

  it("workflow describe prints the named workflow's steps", () => {
    runCli(["add", "workflow", "new-service", "--quiet"], { cwd: tmp });
    const result = runCli(["workflow", "describe", "new-service"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("new-service");
    expect(result.stdout).toContain("Steps:");
    expect(result.stdout).toMatch(/\[prompt\]/);
    expect(result.stdout).toMatch(/\[command\]/);
    expect(result.stdout).toMatch(/\[audit\]/);
  });

  it("workflow describe fails with available list when the id is unknown", () => {
    runCli(["add", "workflow", "new-service", "--quiet"], { cwd: tmp });
    const result = runCli(["workflow", "describe", "made-up"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/not found/);
    expect(result.output).toMatch(/new-service/);
  });

  it("workflow start fails when the id is unknown", () => {
    const result = runCli(["workflow", "start", "made-up"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/not found/);
  });

  it("workflow start runs an inline command-only workflow end-to-end", () => {
    // Write an inline workflow that has no prompts (subprocess can't
    // drive prompts without a TTY).
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    const outputFile = join(tmp, "captured.txt");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: write-greeting
    name: Write Greeting
    description: Echo a greeting from --var to a file
    steps:
      - name: write
        type: command
        command: "echo \${GREETING} > ${outputFile}"
`,
    );

    const result = runCli(
      ["workflow", "start", "write-greeting", "--var", "GREETING=howdy"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Running workflow: write-greeting/);
    expect(result.stdout).toMatch(/done/);

    // Verify the variable actually reached the spawned command.
    expect(readFileSync(outputFile, "utf8").trim()).toBe("howdy");
  });

  it("workflow start halts on the first failed step", () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: halt-test
    name: Halt Test
    description: First step fails, second must not run
    steps:
      - name: fail step
        type: command
        command: "false"
      - name: must-not-run
        type: command
        command: "echo should-never-print"
`,
    );

    const result = runCli(["workflow", "start", "halt-test"], { cwd: tmp });
    // We don't care about exit code for the workflow runner itself
    // (the harness exits 0 even if a step failed — by design, the
    // step-failure signal lives in the rendered output / step results).
    expect(result.stdout).toMatch(/failed/);
    expect(result.stdout).not.toMatch(/should-never-print/);
  });
});
