/**
 * Tests for the v2 cross-cutting hooks subsystem (Primitive 3).
 *
 * Coverage targets:
 *   - schema validation (valid manifests pass; missing required fields
 *     fail; unknown step types fail)
 *   - discoverer walks substrate/hooks/, sorts by order then id,
 *     surfaces invalid manifests separately
 *   - findMatchingHooks filters by trigger + matches.{workflow-id,
 *     workflow-kind, step-id, exit-code}
 *   - dispatchHooks runs run-deterministic hooks end-to-end
 *   - noop hooks resolve to built-in handlers (auto-drift-detect
 *     returns status=deferred with "B3" message)
 *   - hooks list / hooks describe CLI commands surface registry data
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverHooks,
  findMatchingHooks,
  validateHookManifest,
} from "../src/v2/hooks.js";
import { dispatchHooks } from "../src/v2/orchestrator/hook-dispatch.js";
import {
  runHooksDescribe,
  runHooksList,
} from "../src/v2/deterministic/hooks-command.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function seedHook(cwd: string, filename: string, content: string): void {
  const dir = join(cwd, "substrate", "hooks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

describe("validateHookManifest", () => {
  it("accepts a minimal valid hook", () => {
    const result = validateHookManifest({
      schema_version: "v2.0",
      id: "h1",
      trigger: ["workflow-completion"],
      step: { type: "run-deterministic", command: "true" },
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects manifest missing required fields", () => {
    const result = validateHookManifest({ schema_version: "v2.0", id: "x" });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects unknown step type", () => {
    const result = validateHookManifest({
      schema_version: "v2.0",
      id: "h1",
      trigger: ["workflow-completion"],
      step: { type: "fly-to-the-moon" },
    });
    expect(result.ok).toBe(false);
  });

  it("requires command when step.type=run-deterministic", () => {
    const result = validateHookManifest({
      schema_version: "v2.0",
      id: "h1",
      trigger: ["workflow-completion"],
      step: { type: "run-deterministic" },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts noop step type without command", () => {
    const result = validateHookManifest({
      schema_version: "v2.0",
      id: "h1",
      trigger: ["workflow-completion"],
      step: { type: "noop", handler: "x" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown trigger kind", () => {
    const result = validateHookManifest({
      schema_version: "v2.0",
      id: "h1",
      trigger: ["unknown-event"],
      step: { type: "noop" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("discoverHooks", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns empty result when hooks dir is missing", () => {
    const result = discoverHooks({ cwd: tmp });
    expect(result.hooks).toEqual([]);
    expect(result.invalidHooks).toEqual([]);
  });

  it("sorts discovered hooks by order ascending then id", () => {
    seedHook(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a-hook\ntrigger: [workflow-completion]\norder: 50\nstep:\n  type: noop\n  handler: a\n`,
    );
    seedHook(
      tmp,
      "b.yaml",
      `schema_version: v2.0\nid: b-hook\ntrigger: [workflow-completion]\norder: 10\nstep:\n  type: noop\n  handler: b\n`,
    );
    seedHook(
      tmp,
      "c.yaml",
      `schema_version: v2.0\nid: c-hook\ntrigger: [workflow-completion]\norder: 10\nstep:\n  type: noop\n  handler: c\n`,
    );
    const result = discoverHooks({ cwd: tmp });
    expect(result.hooks.map((h) => h.manifest.id)).toEqual([
      "b-hook",
      "c-hook",
      "a-hook",
    ]);
  });

  it("segregates invalid manifests", () => {
    seedHook(tmp, "ok.yaml", `schema_version: v2.0\nid: ok\ntrigger: [workflow-completion]\nstep:\n  type: noop\n`);
    seedHook(tmp, "bad.yaml", `schema_version: v2.0\nid: bad\n`);
    const result = discoverHooks({ cwd: tmp });
    expect(result.hooks.map((h) => h.manifest.id)).toEqual(["ok"]);
    expect(result.invalidHooks.length).toBe(1);
  });
});

describe("findMatchingHooks", () => {
  it("filters by trigger", () => {
    const hooks = [
      makeDescriptor({ id: "x", trigger: ["workflow-start"], step: { type: "noop" } }),
      makeDescriptor({
        id: "y",
        trigger: ["workflow-completion"],
        step: { type: "noop" },
      }),
    ];
    expect(
      findMatchingHooks(hooks, { trigger: "workflow-start" }).map(
        (h) => h.manifest.id,
      ),
    ).toEqual(["x"]);
  });

  it("filters by workflow-kind match", () => {
    const hooks = [
      makeDescriptor({
        id: "audit-only",
        trigger: ["workflow-completion"],
        matches: { "workflow-kind": "audit" },
        step: { type: "noop" },
      }),
    ];
    expect(
      findMatchingHooks(hooks, {
        trigger: "workflow-completion",
        workflowKind: "review",
      }),
    ).toEqual([]);
    expect(
      findMatchingHooks(hooks, {
        trigger: "workflow-completion",
        workflowKind: "audit",
      }).length,
    ).toBe(1);
  });

  it("matches exit-code=any unconditionally", () => {
    const hooks = [
      makeDescriptor({
        id: "any",
        trigger: ["workflow-completion"],
        matches: { "exit-code": "any" },
        step: { type: "noop" },
      }),
    ];
    expect(
      findMatchingHooks(hooks, {
        trigger: "workflow-completion",
        exitCode: 5,
      }).length,
    ).toBe(1);
  });

  it("matches exit-code=pass when exit is 0", () => {
    const hooks = [
      makeDescriptor({
        id: "pass",
        trigger: ["workflow-completion"],
        matches: { "exit-code": "pass" },
        step: { type: "noop" },
      }),
    ];
    expect(
      findMatchingHooks(hooks, {
        trigger: "workflow-completion",
        exitCode: 0,
      }).length,
    ).toBe(1);
    expect(
      findMatchingHooks(hooks, {
        trigger: "workflow-completion",
        exitCode: 1,
      }).length,
    ).toBe(0);
  });

  it("excludes disabled hooks", () => {
    const hooks = [
      makeDescriptor({
        id: "off",
        trigger: ["workflow-completion"],
        enabled: false,
        step: { type: "noop" },
      }),
    ];
    expect(
      findMatchingHooks(hooks, { trigger: "workflow-completion" }),
    ).toEqual([]);
  });
});

describe("dispatchHooks", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    tmp = makeTempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    removeTempDir(tmp);
    logSpy.mockRestore();
  });

  it("runs a run-deterministic hook end-to-end (status=ok)", async () => {
    seedHook(
      tmp,
      "ok.yaml",
      `schema_version: v2.0\nid: ok-hook\ntrigger: [workflow-completion]\nstep:\n  type: run-deterministic\n  command: "true"\n`,
    );
    const records = await dispatchHooks(
      { trigger: "workflow-completion" },
      { cwd: tmp, quiet: true },
    );
    expect(records.length).toBe(1);
    expect(records[0].status).toBe("ok");
  });

  it("returns status=skipped on non-zero exit when fail-on-error is false", async () => {
    seedHook(
      tmp,
      "fail.yaml",
      `schema_version: v2.0\nid: fail-hook\ntrigger: [workflow-completion]\nstep:\n  type: run-deterministic\n  command: "exit 7"\n  fail-on-error: false\n`,
    );
    const records = await dispatchHooks(
      { trigger: "workflow-completion" },
      { cwd: tmp, quiet: true },
    );
    expect(records[0].status).toBe("skipped");
  });

  it("returns status=failed on non-zero exit when fail-on-error is true", async () => {
    seedHook(
      tmp,
      "fail.yaml",
      `schema_version: v2.0\nid: fail-hook\ntrigger: [workflow-completion]\nstep:\n  type: run-deterministic\n  command: "exit 1"\n  fail-on-error: true\n`,
    );
    const records = await dispatchHooks(
      { trigger: "workflow-completion" },
      { cwd: tmp, quiet: true },
    );
    expect(records[0].status).toBe("failed");
  });

  it("auto-drift-detect noop handler returns status=deferred (B3 placeholder)", async () => {
    seedHook(
      tmp,
      "drift.yaml",
      `schema_version: v2.0\nid: auto-drift-detect\ntrigger: [workflow-completion]\nstep:\n  type: noop\n  handler: auto-drift-detect\n`,
    );
    const records = await dispatchHooks(
      { trigger: "workflow-completion" },
      { cwd: tmp, quiet: true },
    );
    expect(records[0].status).toBe("deferred");
    expect(records[0].message).toMatch(/B3/);
  });

  it("noop with unknown handler returns status=skipped", async () => {
    seedHook(
      tmp,
      "x.yaml",
      `schema_version: v2.0\nid: my-noop\ntrigger: [workflow-completion]\nstep:\n  type: noop\n  handler: does-not-exist\n`,
    );
    const records = await dispatchHooks(
      { trigger: "workflow-completion" },
      { cwd: tmp, quiet: true },
    );
    expect(records[0].status).toBe("skipped");
    expect(records[0].message).toMatch(/unknown handler/);
  });
});

describe("runHooksList / runHooksDescribe", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    tmp = makeTempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    removeTempDir(tmp);
    logSpy.mockRestore();
  });

  it("lists discovered hooks", () => {
    seedHook(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\ntrigger: [workflow-completion]\nstep:\n  type: noop\n`,
    );
    const result = runHooksList({ cwd: tmp, quiet: true });
    expect(result.hooks.length).toBe(1);
    expect(result.hooks[0].id).toBe("a");
  });

  it("filters list by trigger kind", () => {
    seedHook(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\ntrigger: [workflow-start]\nstep:\n  type: noop\n`,
    );
    seedHook(
      tmp,
      "b.yaml",
      `schema_version: v2.0\nid: b\ntrigger: [workflow-completion]\nstep:\n  type: noop\n`,
    );
    const result = runHooksList({
      cwd: tmp,
      trigger: ["workflow-start"],
      quiet: true,
    });
    expect(result.hooks.map((h) => h.id)).toEqual(["a"]);
  });

  it("describe returns found=false for unknown hook", () => {
    const result = runHooksDescribe({
      id: "missing",
      cwd: tmp,
      quiet: true,
    });
    expect(result.found).toBe(false);
  });

  it("describe returns hook details when present", () => {
    seedHook(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\ndescription: a hook\ntrigger: [workflow-completion]\nstep:\n  type: noop\n`,
    );
    const result = runHooksDescribe({ id: "a", cwd: tmp, quiet: true });
    expect(result.found).toBe(true);
    expect(result.hook?.description).toBe("a hook");
  });
});

function makeDescriptor(partial: {
  id: string;
  trigger: string[];
  matches?: Record<string, unknown>;
  enabled?: boolean;
  step: Record<string, unknown>;
}) {
  return {
    manifest: {
      schema_version: "v2.0" as const,
      id: partial.id,
      trigger: partial.trigger as (
        | "workflow-start"
        | "workflow-step-completion"
        | "workflow-completion"
        | "session-start"
        | "session-end"
        | "file-change"
      )[],
      matches: partial.matches as Record<string, never> | undefined,
      enabled: partial.enabled,
      step: partial.step as { type: "noop" | "run-deterministic" },
    },
    manifestPath: `/tmp/${partial.id}.yaml`,
  };
}
