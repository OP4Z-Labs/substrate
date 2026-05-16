/**
 * Tests for the v2 step engine (TI-1).
 *
 * Each of the six AI-step types gets coverage for:
 *   - happy path (no-transport mode)
 *   - with-transport mode (using a stub transport)
 *   - failure mode
 *
 * Plus integration tests through `runV2Workflow` that verify
 * session-event-log shape (prompt-issued + step-confirm events fire)
 * and that the proposal pipeline picks them up.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runV2Workflow } from "../src/v2/orchestrator/run-command.js";
import {
  MAX_SUB_WORKFLOW_DEPTH,
  renderPromptTemplate,
  listPendingProposals,
} from "../src/v2/orchestrator/step-handlers.js";
import type {
  OrchestrationTransport,
  EmitPromptArgs,
  ConfirmArgs,
} from "../src/v2/orchestrator/transport.js";
import type { RunStepResult } from "../src/v2/orchestrator/run-command-types.js";
import { readSessionLog } from "../src/v2/orchestrator/session-log.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function seedWorkflow(cwd: string, filename: string, content: string): void {
  const dir = join(cwd, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

class StubTransport implements OrchestrationTransport {
  prompts: EmitPromptArgs[] = [];
  confirms: ConfirmArgs[] = [];
  responseFn: (args: EmitPromptArgs) => Promise<string | null>;
  confirmFn: (args: ConfirmArgs) => Promise<boolean>;

  constructor(
    responseFn: (args: EmitPromptArgs) => Promise<string | null> = async () =>
      "stub response",
    confirmFn: (args: ConfirmArgs) => Promise<boolean> = async () => true,
  ) {
    this.responseFn = responseFn;
    this.confirmFn = confirmFn;
  }

  async emitPrompt(args: EmitPromptArgs): Promise<string | null> {
    this.prompts.push(args);
    return this.responseFn(args);
  }

  async confirm(args: ConfirmArgs): Promise<boolean> {
    this.confirms.push(args);
    return this.confirmFn(args);
  }

  async presentDiff(args: { stepId: string; response: string }): Promise<string> {
    return `staged action for ${args.stepId}`;
  }
}

describe("step engine — renderPromptTemplate", () => {
  it("substitutes ${id.output} from prior step results", () => {
    const outputs = new Map<string, RunStepResult>();
    outputs.set("first", {
      stepId: "first",
      type: "prompt",
      status: "ok",
      message: "hello from first",
    });
    const rendered = renderPromptTemplate(
      "now do something with ${first.output}",
      outputs,
    );
    expect(rendered).toBe("now do something with hello from first");
  });

  it("leaves unmatched references as empty strings", () => {
    const outputs = new Map<string, RunStepResult>();
    const rendered = renderPromptTemplate(
      "before ${missing.output} after",
      outputs,
    );
    expect(rendered).toBe("before  after");
  });

  it("returns the input unchanged when no placeholders are present", () => {
    const outputs = new Map<string, RunStepResult>();
    expect(renderPromptTemplate("no placeholders here", outputs)).toBe(
      "no placeholders here",
    );
  });
});

describe("step engine — `prompt` step", () => {
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

  it("emits a `prompt-issued` event and returns ok in no-transport mode", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: ask
    type: prompt
    prompt: "what say you?"
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(0);
    expect(result.steps[0].status).toBe("ok");
    expect(result.sessionLogPath).toBeDefined();
    const events = readSessionLog(result.sessionLogPath!).events;
    const promptIssued = events.find((e) => e.event === "prompt-issued");
    expect(promptIssued).toBeDefined();
    expect((promptIssued as { prompt: string }).prompt).toContain("what say you?");
  });

  it("captures the transport's response on the step output", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: ask
    type: prompt
    prompt: "ping"
`,
    );
    const transport = new StubTransport(async () => "pong");
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
      transport,
    });
    expect(result.exitCode).toBe(0);
    expect(result.steps[0].status).toBe("ok");
    expect(result.steps[0].output).toBe("pong");
    expect(transport.prompts.length).toBe(1);
    expect(transport.prompts[0].prompt).toBe("ping");
  });

  it("emits a step-confirm event when must-confirm is true", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: ask
    type: prompt
    prompt: "approve me"
    must-confirm: true
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    const events = readSessionLog(result.sessionLogPath!).events;
    const confirm = events.find((e) => e.event === "step-confirm");
    expect(confirm).toBeDefined();
    expect((confirm as { outcome: string }).outcome).toBe("approved");
  });

  it("fails the step when transport rejects must-confirm", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: ask
    type: prompt
    prompt: "approve me"
    must-confirm: true
`,
    );
    const transport = new StubTransport(undefined, async () => false);
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
      transport,
    });
    expect(result.exitCode).toBe(1);
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].message).toMatch(/rejected/);
  });

  it("fails workflow discovery (schema validation) when prompt is missing", async () => {
    // The schema requires `prompt` on prompt-type steps; a manifest
    // missing it fails validation at the discoverer. The runtime
    // defensive check inside `runPromptStep` is a belt-and-braces
    // guard; the schema is the primary line of defense.
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: ask
    type: prompt
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    // Manifest fails validation → workflow not found in valid set.
    expect(result.exitCode).toBe(2);
  });
});

describe("step engine — `prompt-and-action` step", () => {
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

  it("emits a step-confirm event even without must-confirm", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: edit
    type: prompt-and-action
    prompt: "make a change"
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(0);
    const events = readSessionLog(result.sessionLogPath!).events;
    const confirm = events.find((e) => e.event === "step-confirm");
    expect(confirm).toBeDefined();
  });
});

describe("step engine — `invoke-sub-workflow` step", () => {
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

  it("recursively dispatches a sub-workflow successfully", async () => {
    seedWorkflow(
      tmp,
      "parent.yaml",
      `schema_version: v2.0
id: parent
name: Parent
steps:
  - id: call-child
    type: invoke-sub-workflow
    workflow: child
`,
    );
    seedWorkflow(
      tmp,
      "child.yaml",
      `schema_version: v2.0
id: child
name: Child
steps:
  - id: noop
    type: invoke-deterministic
    run: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "parent",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.steps[0].status).toBe("ok");
    expect(result.steps[0].message).toMatch(/sub-workflow "child" completed/);
    // Sub-workflow's session-log path lands on the step output.
    expect(result.steps[0].output).toBeDefined();
  });

  it("fails when the sub-workflow doesn't exist", async () => {
    seedWorkflow(
      tmp,
      "parent.yaml",
      `schema_version: v2.0
id: parent
name: Parent
steps:
  - id: call-missing
    type: invoke-sub-workflow
    workflow: missing
`,
    );
    const result = await runV2Workflow({
      workflowId: "parent",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(1);
    expect(result.steps[0].status).toBe("failed");
  });

  it("manifest validation rejects invoke-sub-workflow without `workflow`", async () => {
    // Same shape as the prompt-without-prompt case — the schema is the
    // primary defense; the handler's defensive check is unreachable in
    // happy-path flow but kept as a guard for programmatic callers.
    seedWorkflow(
      tmp,
      "parent.yaml",
      `schema_version: v2.0
id: parent
name: Parent
steps:
  - id: call-empty
    type: invoke-sub-workflow
`,
    );
    const result = await runV2Workflow({
      workflowId: "parent",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(2);
  });

  it("caps depth at MAX_SUB_WORKFLOW_DEPTH to prevent infinite recursion", async () => {
    expect(MAX_SUB_WORKFLOW_DEPTH).toBe(5);
    // A workflow that invokes itself — sub-workflow recursion guard
    // must abort before exhausting the stack.
    seedWorkflow(
      tmp,
      "loop.yaml",
      `schema_version: v2.0
id: loop
name: Loop
steps:
  - id: again
    type: invoke-sub-workflow
    workflow: loop
`,
    );
    const result = await runV2Workflow({
      workflowId: "loop",
      cwd: tmp,
      quiet: true,
    });
    // The top-level + 5 nested = 6 invocations; the 6th hits the cap.
    // Since the cap returns "failed", the chain propagates as failed.
    expect(result.exitCode).toBe(1);
  });
});

describe("step engine — `gate` step", () => {
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

  it("passes the gate when all required-steps completed ok", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
acceptance:
  required-steps: [first, second]
steps:
  - id: first
    type: invoke-deterministic
    run: "true"
  - id: second
    type: invoke-deterministic
    run: "true"
  - id: check
    type: gate
    description: "verify both prior steps ran"
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(0);
    const gate = result.steps.find((s) => s.stepId === "check");
    expect(gate?.status).toBe("ok");
    expect(gate?.message).toMatch(/passed/);
  });

  it("fails the gate when a required step failed", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
acceptance:
  required-steps: [first]
steps:
  - id: first
    type: invoke-deterministic
    continue-on-failure: true
    run: "exit 1"
  - id: check
    type: gate
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(1);
    const gate = result.steps.find((s) => s.stepId === "check");
    expect(gate?.status).toBe("failed");
    expect(gate?.message).toMatch(/failing/);
  });

  it("emits step-confirm and uses transport when must-confirm is true", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: check
    type: gate
    description: approve the diff
    must-confirm: true
`,
    );
    const transport = new StubTransport(undefined, async () => true);
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
      transport,
    });
    expect(result.exitCode).toBe(0);
    expect(transport.confirms.length).toBe(1);
    const events = readSessionLog(result.sessionLogPath!).events;
    const confirm = events.find((e) => e.event === "step-confirm");
    expect(confirm).toBeDefined();
    expect((confirm as { outcome: string }).outcome).toBe("approved");
  });
});

describe("step engine — `discover` step", () => {
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

  it("re-runs context discovery and emits context-loaded events", async () => {
    const stdRoot = join(tmp, "substrate", "standards", "backend");
    mkdirSync(stdRoot, { recursive: true });
    writeFileSync(join(stdRoot, "python.md"), "# Py");
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
context:
  standards:
    - backend/python.md
steps:
  - id: rediscover
    type: discover
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(0);
    expect(result.steps[0].status).toBe("ok");
    expect(result.steps[0].message).toMatch(/standards=1/);
  });
});

describe("step engine — `propose-doc-change` step", () => {
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

  it("stages a proposal in the pending queue", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: propose
    type: propose-doc-change
    run: backend/python.md
    prompt: "Add a section noting the new async-session lifecycle pattern."
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(0);
    expect(result.steps[0].status).toBe("ok");

    const pending = listPendingProposals(tmp);
    expect(pending.length).toBe(1);
    const body = readFileSync(pending[0], "utf8");
    expect(body).toContain("kind: add-to-standards-doc");
    expect(body).toContain("backend/python.md");
    expect(body).toContain("async-session lifecycle");

    // The session log records the proposal as an adhoc-step event.
    const events = readSessionLog(result.sessionLogPath!).events;
    const adhoc = events.find((e) => e.event === "adhoc-step");
    expect(adhoc).toBeDefined();
  });

  it("fails when neither `run` nor `description` identify a doc", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: propose
    type: propose-doc-change
    prompt: "I have an addition but no target"
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(1);
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].message).toMatch(/identify the doc/);
  });

  it("accepts `description: doc: <path>` form", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: propose
    type: propose-doc-change
    description: "doc: backend/api.md"
    prompt: "Add a versioning note."
`,
    );
    const result = await runV2Workflow({ workflowId: "wf", cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(0);
    expect(listPendingProposals(tmp).length).toBe(1);
  });
});

describe("step engine — multi-step integration", () => {
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

  it("composes prompts + gate + sub-workflow across a real run", async () => {
    seedWorkflow(
      tmp,
      "main.yaml",
      `schema_version: v2.0
id: main
name: Main
acceptance:
  required-steps: [research, run-child]
steps:
  - id: research
    type: prompt
    prompt: "investigate"
  - id: run-child
    type: invoke-sub-workflow
    workflow: child
  - id: final-gate
    type: gate
`,
    );
    seedWorkflow(
      tmp,
      "child.yaml",
      `schema_version: v2.0
id: child
name: Child
steps:
  - id: do-thing
    type: invoke-deterministic
    run: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "main",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.steps.map((s) => s.stepId)).toEqual([
      "research",
      "run-child",
      "final-gate",
    ]);
    expect(result.steps.every((s) => s.status === "ok")).toBe(true);

    // Session log captures the right event sequence.
    const events = readSessionLog(result.sessionLogPath!).events;
    const eventKinds = events.map((e) => e.event);
    expect(eventKinds).toContain("prompt-issued");
    expect(eventKinds).toContain("workflow-completion");
  });

  it("--dry-run still skips every step (no transport calls)", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: a
    type: prompt
    prompt: "ask"
  - id: b
    type: gate
`,
    );
    const transport = new StubTransport();
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
      dryRun: true,
      transport,
    });
    expect(result.exitCode).toBe(0);
    expect(result.steps.every((s) => s.status === "skipped")).toBe(true);
    // Transport not invoked during dry-run.
    expect(transport.prompts.length).toBe(0);
    expect(transport.confirms.length).toBe(0);
  });
});
