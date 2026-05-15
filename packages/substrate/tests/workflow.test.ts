/**
 * Unit tests for the v0.5 workflow runtime.
 *
 * Covers:
 *   - Manifest loading from both v0.3 (list of IDs) and v0.5 (inline
 *     definitions) shapes
 *   - workflow list / describe / start verbs
 *   - All three step types: command, audit, prompt
 *   - Variable substitution (${VAR} tokens)
 *   - Condition handling
 *   - Default `new-service` bundled workflow
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdd } from "../src/commands/add.js";
import { runInit } from "../src/commands/init.js";
import {
  readWorkflowsManifest,
  runWorkflowDescribe,
  runWorkflowList,
  runWorkflowStart,
} from "../src/commands/workflow.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("readWorkflowsManifest", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "wf", shortCode: "WF", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns [] when no workflows.yaml exists", () => {
    expect(readWorkflowsManifest(tmp)).toEqual([]);
  });

  it("resolves bundled definitions when workflows.yaml uses the v0.3 list-of-IDs shape", () => {
    // `substrate add workflow new-service` writes the v0.3 shape.
    runAdd({ category: "workflow", item: "new-service", cwd: tmp, quiet: true });
    const list = readWorkflowsManifest(tmp);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("new-service");
    expect(list[0].steps.length).toBeGreaterThan(0);
    expect(list[0].name).toContain("Service");
  });

  it("parses inline v0.5 definitions when workflows.yaml carries full step bodies", () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: hello
    name: Hello World
    description: Echo a greeting
    steps:
      - name: Say hi
        type: command
        command: "echo hello"
`,
    );
    const list = readWorkflowsManifest(tmp);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("hello");
    expect(list[0].name).toBe("Hello World");
    expect(list[0].steps.length).toBe(1);
    expect(list[0].steps[0].type).toBe("command");
  });

  it("preserves ID-only entries that have no bundled definition", () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(manifestPath, "workflows:\n  - made-up-id\n");
    const list = readWorkflowsManifest(tmp);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("made-up-id");
    expect(list[0].steps.length).toBe(0);
  });
});

describe("runWorkflowList", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "wf", shortCode: "WF", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns empty array with a no-workflow repo", () => {
    const result = runWorkflowList({ cwd: tmp, quiet: true });
    expect(result).toEqual([]);
  });

  it("returns the registered workflows after `add workflow`", () => {
    runAdd({ category: "workflow", item: "new-service", cwd: tmp, quiet: true });
    const result = runWorkflowList({ cwd: tmp, quiet: true });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("new-service");
  });
});

describe("runWorkflowDescribe", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "wf", shortCode: "WF", quiet: true });
    runAdd({ category: "workflow", item: "new-service", cwd: tmp, quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns the workflow definition for a known id", () => {
    const wf = runWorkflowDescribe({ id: "new-service", cwd: tmp, quiet: true });
    expect(wf.id).toBe("new-service");
    expect(wf.steps.length).toBeGreaterThan(0);
    // The bundled new-service workflow has the four canonical steps.
    const stepTypes = wf.steps.map((s) => s.type);
    expect(stepTypes).toContain("prompt");
    expect(stepTypes).toContain("command");
    expect(stepTypes).toContain("audit");
  });

  it("throws with available list when the id is unknown", () => {
    expect(() =>
      runWorkflowDescribe({ id: "made-up", cwd: tmp, quiet: true }),
    ).toThrow(/not found/);
  });
});

describe("runWorkflowStart", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "wf", shortCode: "WF", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("rejects an unknown workflow id with the available list", async () => {
    await expect(
      runWorkflowStart({ id: "nope", cwd: tmp, quiet: true }),
    ).rejects.toThrow(/not found/);
  });

  it("rejects when the workflow has no steps", async () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(manifestPath, "workflows:\n  - id: empty\n    name: empty\n    steps: []\n");
    await expect(
      runWorkflowStart({ id: "empty", cwd: tmp, quiet: true }),
    ).rejects.toThrow(/no steps/);
  });

  it("runs a single command step and reports ok", async () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: hello
    name: Hello
    description: Echo hello
    steps:
      - name: echo step
        type: command
        command: "true"
`,
    );
    const result = await runWorkflowStart({ id: "hello", cwd: tmp, quiet: true });
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].status).toBe("ok");
  });

  it("reports failed when a command exits non-zero, and halts subsequent steps", async () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: doomed
    name: Doomed
    description: First step fails
    steps:
      - name: fail step
        type: command
        command: "false"
      - name: never reached
        type: command
        command: "true"
`,
    );
    const result = await runWorkflowStart({ id: "doomed", cwd: tmp, quiet: true });
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].status).toBe("failed");
  });

  it("substitutes ${VAR} from --var into command steps", async () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    const outputFile = join(tmp, "captured.txt");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: sub
    name: Sub
    description: Var substitution
    steps:
      - name: write file
        type: command
        command: "echo \${GREETING} > ${outputFile}"
`,
    );
    const result = await runWorkflowStart({
      id: "sub",
      cwd: tmp,
      quiet: true,
      vars: { GREETING: "howdy" },
    });
    expect(result.steps[0].status).toBe("ok");
    // The actual variable substitution is exercised — read the file back.
    const { readFileSync } = await import("node:fs");
    const captured = readFileSync(outputFile, "utf8").trim();
    expect(captured).toBe("howdy");
  });

  it("collects prompt-step answers into the vars bag", async () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: ask
    name: Ask
    description: Ask the user something
    steps:
      - name: ask name
        type: prompt
        prompt: "Your name?"
        var: USER_NAME
      - name: echo it
        type: command
        command: "echo Hello, \${USER_NAME}"
`,
    );
    const result = await runWorkflowStart({
      id: "ask",
      cwd: tmp,
      quiet: true,
      resolvePrompt: () => "Beau",
    });
    expect(result.steps.length).toBe(2);
    expect(result.steps[0].status).toBe("ok");
    expect(result.steps[0].output).toBe("Beau");
    expect(result.vars.USER_NAME).toBe("Beau");
    expect(result.steps[1].status).toBe("ok");
  });

  it("skips a step when its condition substitutes to empty", async () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: cond
    name: Cond
    description: Conditional step
    steps:
      - name: would run if FLAG set
        type: command
        command: "true"
        condition: "\${FLAG}"
`,
    );
    const result = await runWorkflowStart({
      id: "cond",
      cwd: tmp,
      quiet: true,
      vars: {},
    });
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].status).toBe("skipped");
  });

  it("runs the conditional step when the var is provided", async () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: cond2
    name: Cond2
    description: Conditional step (positive)
    steps:
      - name: gated
        type: command
        command: "true"
        condition: "\${FLAG}"
`,
    );
    const result = await runWorkflowStart({
      id: "cond2",
      cwd: tmp,
      quiet: true,
      vars: { FLAG: "yes" },
    });
    expect(result.steps[0].status).toBe("ok");
  });

  it("audit step succeeds for a scaffolded audit", async () => {
    // Scaffold pre-merge audit first so the audit step has something to load.
    runAdd({ category: "audit", item: "pre-merge", cwd: tmp, quiet: true });
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: with-audit
    name: With Audit
    description: Runs an audit step
    steps:
      - name: pre-merge
        type: audit
        audit: pre-merge
`,
    );
    const result = await runWorkflowStart({
      id: "with-audit",
      cwd: tmp,
      quiet: true,
    });
    expect(result.steps[0].status).toBe("ok");
  });

  it("audit step fails cleanly when the audit isn't scaffolded", async () => {
    const manifestPath = join(tmp, "auto", "config", "workflows.yaml");
    writeFileSync(
      manifestPath,
      `workflows:
  - id: bad-audit
    name: Bad audit
    description: Audit not scaffolded
    steps:
      - name: missing
        type: audit
        audit: backend
`,
    );
    const result = await runWorkflowStart({
      id: "bad-audit",
      cwd: tmp,
      quiet: true,
    });
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].error).toMatch(/not found/);
  });
});
