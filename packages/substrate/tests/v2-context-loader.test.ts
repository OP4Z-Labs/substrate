/**
 * Tests for the v2 Context loader.
 *
 * Coverage targets:
 *   - standards resolution from substrate/standards/, standards/,
 *     auto/standards/ (precedence order)
 *   - missing standards produce warnings, not throws
 *   - rules glob matching against RULES.yaml (BE-*, exact ids, *)
 *   - missing RULES.yaml warns, doesn't throw
 *   - memory stub returns empty + B2-deferred warning when declared
 *   - knowledge-sections stub returns empty + B4-deferred warning
 *   - empty context block produces zero warnings
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadContext } from "../src/v2/context-loader.js";
import type { WorkflowManifest } from "../src/v2/types.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function buildManifest(
  overrides: Partial<WorkflowManifest> = {},
): WorkflowManifest {
  return {
    schema_version: "v2.0",
    id: "test-workflow",
    name: "Test Workflow",
    ...overrides,
  };
}

describe("loadContext — empty context", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("produces no warnings when context is empty", () => {
    const result = loadContext({ workflow: buildManifest(), cwd: tmp });
    expect(result.standards).toEqual([]);
    expect(result.memories).toEqual([]);
    expect(result.rules).toEqual([]);
    expect(result.knowledge).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("loadContext — standards", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("loads standards from substrate/standards/ when present", () => {
    const stdRoot = join(tmp, "substrate", "standards", "backend");
    mkdirSync(stdRoot, { recursive: true });
    writeFileSync(join(stdRoot, "python.md"), "# Python standards\nbody");
    const result = loadContext({
      workflow: buildManifest({ context: { standards: ["backend/python.md"] } }),
      cwd: tmp,
    });
    expect(result.standards.length).toBe(1);
    expect(result.standards[0].relativePath).toBe("backend/python.md");
    expect(result.standards[0].body).toContain("Python standards");
    expect(result.warnings).toEqual([]);
  });

  it("falls back to standards/ then auto/standards/ when substrate/standards/ is absent", () => {
    const stdRoot = join(tmp, "standards", "backend");
    mkdirSync(stdRoot, { recursive: true });
    writeFileSync(join(stdRoot, "api.md"), "# API standards");
    const result = loadContext({
      workflow: buildManifest({ context: { standards: ["backend/api.md"] } }),
      cwd: tmp,
    });
    expect(result.standards.length).toBe(1);
    expect(result.standards[0].relativePath).toBe("backend/api.md");
  });

  it("warns when a declared standards doc is missing under the root", () => {
    mkdirSync(join(tmp, "substrate", "standards"), { recursive: true });
    const result = loadContext({
      workflow: buildManifest({ context: { standards: ["missing.md"] } }),
      cwd: tmp,
    });
    expect(result.standards).toEqual([]);
    expect(result.warnings.some((w) => w.includes("missing.md"))).toBe(true);
  });

  it("warns once when no standards root is found", () => {
    const result = loadContext({
      workflow: buildManifest({ context: { standards: ["any.md"] } }),
      cwd: tmp,
    });
    expect(result.standards).toEqual([]);
    expect(result.warnings.some((w) => w.includes("Standards root not found"))).toBe(true);
  });
});

describe("loadContext — rules", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  function writeRulesYaml(tmpRoot: string, body: string): void {
    mkdirSync(join(tmpRoot, "substrate"), { recursive: true });
    writeFileSync(join(tmpRoot, "substrate", "RULES.yaml"), body);
  }

  it("filters rules by glob pattern", () => {
    writeRulesYaml(
      tmp,
      `rules:
  - id: BE-PY-001
    title: First
    severity: high
  - id: BE-PY-002
    title: Second
    severity: medium
  - id: FE-REACT-001
    title: Third
    severity: low
`,
    );
    const result = loadContext({
      workflow: buildManifest({ context: { rules: ["BE-PY-*"] } }),
      cwd: tmp,
    });
    expect(result.rules.map((r) => r.id).sort()).toEqual(["BE-PY-001", "BE-PY-002"]);
  });

  it("matches multiple patterns (OR)", () => {
    writeRulesYaml(
      tmp,
      `rules:
  - id: BE-PY-001
    title: A
    severity: high
  - id: FE-REACT-001
    title: B
    severity: low
  - id: SEC-CRYPT-001
    title: C
    severity: critical
`,
    );
    const result = loadContext({
      workflow: buildManifest({
        context: { rules: ["BE-*", "FE-*"] },
      }),
      cwd: tmp,
    });
    expect(result.rules.map((r) => r.id).sort()).toEqual([
      "BE-PY-001",
      "FE-REACT-001",
    ]);
  });

  it("warns when RULES.yaml is missing", () => {
    const result = loadContext({
      workflow: buildManifest({ context: { rules: ["BE-*"] } }),
      cwd: tmp,
    });
    expect(result.rules).toEqual([]);
    expect(result.warnings.some((w) => w.includes("RULES.yaml not found"))).toBe(true);
  });
});

describe("loadContext — memory (B2: first-class loading)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("warns about no memory store when memory is declared but no store is configured", () => {
    // No --memory-path, no $SUBSTRATE_MEMORY_PATH, no
    // substrate.config.json memory.path, and tmp's encoded
    // Claude Code dir doesn't exist either. Result: warning, no memories.
    const result = loadContext({
      workflow: buildManifest({
        context: { memory: { types: ["feedback"], scope: "backend" } },
      }),
      cwd: tmp,
      homeDir: tmp, // ensure Claude Code default resolves to a missing dir
    });
    expect(result.memories).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes("No memory store found")),
    ).toBe(true);
  });

  it("loads memories from a directory passed via memoryPath", () => {
    const memDir = join(tmp, "mem");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, "feedback-x.md"),
      `---\nname: feedback-x\ndescription: a feedback memory\nmetadata:\n  type: feedback\n  scope: backend\n  tags:\n    - api\n---\nbody content here`,
    );
    const result = loadContext({
      workflow: buildManifest({
        context: { memory: { types: ["feedback"], scope: "backend" } },
      }),
      cwd: tmp,
      memoryPath: memDir,
      homeDir: tmp,
    });
    expect(result.memories.length).toBe(1);
    expect(result.memories[0].name).toBe("feedback-x");
    expect(result.memories[0].type).toBe("feedback");
    expect(result.memories[0].scope).toBe("backend");
    expect(result.memoryInjection).toContain(
      "Relevant prior decisions and feedback",
    );
    expect(result.memoryInjection).toContain("feedback-x");
  });

  it("does not warn when memory is not declared", () => {
    const result = loadContext({ workflow: buildManifest(), cwd: tmp });
    expect(result.memories).toEqual([]);
    expect(result.warnings.filter((w) => w.includes("memory"))).toEqual([]);
  });
});

describe("loadContext — knowledge-sections stub", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns empty knowledge with a B4-deferred warning when declared", () => {
    const result = loadContext({
      workflow: buildManifest({
        context: { "knowledge-sections": ["postgres"] },
      }),
      cwd: tmp,
    });
    expect(result.knowledge).toEqual([]);
    expect(result.warnings.some((w) => w.includes("B4"))).toBe(true);
  });
});
