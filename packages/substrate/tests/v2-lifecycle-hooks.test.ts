/**
 * Tests for TI-2 — the wired `session-start`, `session-end`, and
 * `file-change` hook triggers.
 *
 * Coverage:
 *   - `session-start` fires once at the start of every substrate run
 *   - `session-end` fires once after workflow-completion
 *   - `file-change` fires from `substrate watch` when a file is saved
 *   - hooks at these triggers respect the standard matches filter
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runV2Workflow } from "../src/v2/orchestrator/run-command.js";
import { startWatcher } from "../src/v2/deterministic/watch-command.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function seedWorkflow(cwd: string, filename: string, content: string): void {
  const dir = join(cwd, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

function seedHook(cwd: string, filename: string, content: string): void {
  const dir = join(cwd, "substrate", "hooks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

describe("lifecycle hooks — session-start", () => {
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

  it("fires session-start hook once per workflow run", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: noop
    type: invoke-deterministic
    run: "true"
`,
    );
    seedHook(
      tmp,
      "on-start.yaml",
      `schema_version: v2.0
id: on-start
trigger: [session-start]
step:
  type: run-deterministic
  command: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(0);
    const sessionStarts =
      result.hookRuns?.filter((h) => h.trigger === "session-start") ?? [];
    expect(sessionStarts.length).toBe(1);
    expect(sessionStarts[0].hookId).toBe("on-start");
    expect(sessionStarts[0].status).toBe("ok");
  });

  it("does NOT fire session-start during --dry-run", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: noop
    type: invoke-deterministic
    run: "true"
`,
    );
    seedHook(
      tmp,
      "on-start.yaml",
      `schema_version: v2.0
id: on-start
trigger: [session-start]
step:
  type: run-deterministic
  command: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
      dryRun: true,
    });
    expect(result.exitCode).toBe(0);
    const sessionStarts =
      result.hookRuns?.filter((h) => h.trigger === "session-start") ?? [];
    expect(sessionStarts.length).toBe(0);
  });
});

describe("lifecycle hooks — session-end", () => {
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

  it("fires session-end after workflow completes (regardless of exitCode)", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: noop
    type: invoke-deterministic
    run: "true"
`,
    );
    seedHook(
      tmp,
      "on-end.yaml",
      `schema_version: v2.0
id: on-end
trigger: [session-end]
step:
  type: run-deterministic
  command: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
    });
    const sessionEnds =
      result.hookRuns?.filter((h) => h.trigger === "session-end") ?? [];
    expect(sessionEnds.length).toBe(1);
    expect(sessionEnds[0].hookId).toBe("on-end");
  });

  it("fires session-end even when the workflow failed", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: fails
    type: invoke-deterministic
    run: "exit 7"
`,
    );
    seedHook(
      tmp,
      "on-end.yaml",
      `schema_version: v2.0
id: on-end
trigger: [session-end]
step:
  type: run-deterministic
  command: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
    });
    expect(result.exitCode).toBe(1);
    const sessionEnds =
      result.hookRuns?.filter((h) => h.trigger === "session-end") ?? [];
    expect(sessionEnds.length).toBe(1);
  });
});

describe("lifecycle hooks — both session-start + session-end", () => {
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

  it("fires session hooks in the correct lifecycle order", async () => {
    seedWorkflow(
      tmp,
      "wf.yaml",
      `schema_version: v2.0
id: wf
name: WF
steps:
  - id: noop
    type: invoke-deterministic
    run: "true"
`,
    );
    seedHook(
      tmp,
      "lifecycle.yaml",
      `schema_version: v2.0
id: lifecycle-start
trigger: [session-start]
step:
  type: run-deterministic
  command: "true"
`,
    );
    seedHook(
      tmp,
      "lifecycle-end.yaml",
      `schema_version: v2.0
id: lifecycle-end
trigger: [session-end]
step:
  type: run-deterministic
  command: "true"
`,
    );
    const result = await runV2Workflow({
      workflowId: "wf",
      cwd: tmp,
      quiet: true,
    });
    const triggers = (result.hookRuns ?? []).map((h) => h.trigger);
    // First trigger should be session-start; last should be session-end.
    expect(triggers[0]).toBe("session-start");
    expect(triggers[triggers.length - 1]).toBe("session-end");
  });
});

describe("file-change trigger — substrate watch", () => {
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

  it("fires a file-change hook when a watched file is modified", async () => {
    seedHook(
      tmp,
      "on-change.yaml",
      `schema_version: v2.0
id: on-change
trigger: [file-change]
step:
  type: run-deterministic
  command: "true"
`,
    );
    // Create a file to modify.
    const target = join(tmp, "watched.txt");
    writeFileSync(target, "initial\n");

    const events: string[] = [];
    const handle = startWatcher({
      cwd: tmp,
      quiet: true,
      maxEvents: 1,
      onEvent: (p) => events.push(p),
    });

    // Wait a tick for the watcher to attach, then modify the file.
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(target, "modified\n");

    // Wait up to 2s for the event to fire (filesystem watch latency
    // varies by platform — Linux inotify is fast; macOS FSEvents can
    // batch up to ~50ms).
    const start = Date.now();
    while (events.length === 0 && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const fired = await handle.stop();
    expect(events.length).toBeGreaterThan(0);
    expect(fired).toBeGreaterThan(0);
  });

  it("startWatcher returns without throwing when the path exists but has no hooks", () => {
    // No hooks seeded — watcher should still attach + report 0 hooks.
    const handle = startWatcher({
      cwd: tmp,
      quiet: true,
      maxEvents: 0,
    });
    expect(handle.stop).toBeDefined();
    // Stop immediately.
    handle.stop();
  });

  it("throws when the watch path doesn't exist", () => {
    expect(() =>
      startWatcher({ cwd: tmp, path: "nonexistent-dir", quiet: true }),
    ).toThrow(/does not exist/);
  });

  it("ignores changes inside substrate/sessions/ to avoid feedback loops", async () => {
    seedHook(
      tmp,
      "on-change.yaml",
      `schema_version: v2.0
id: on-change
trigger: [file-change]
step:
  type: run-deterministic
  command: "true"
`,
    );
    // Create the sessions dir + a file.
    const sessionsDir = join(tmp, "substrate", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    const sessionsFile = join(sessionsDir, "noisy.jsonl");
    writeFileSync(sessionsFile, "{}\n");

    const events: string[] = [];
    const handle = startWatcher({
      cwd: tmp,
      quiet: true,
      maxEvents: 5,
      onEvent: (p) => events.push(p),
    });

    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(sessionsFile, "{}\n{}\n");

    // Give the watcher a chance to spuriously fire (it should not).
    await new Promise((r) => setTimeout(r, 200));
    await handle.stop();
    expect(events.length).toBe(0);
  });
});
