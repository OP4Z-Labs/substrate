/**
 * Tests for the deterministic-layer `substrate query` family.
 *
 * Coverage targets:
 *   - query rules: filters by --by-prefix; warns when RULES.yaml missing
 *   - query standards: walks substrate/standards/, returns relative paths
 *   - query memory: B1 stub returns empty + a deferred warning
 *   - --json output is parseable JSON for each subject
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runQueryMemory,
  runQueryRules,
  runQueryStandards,
} from "../src/v2/deterministic/query-command.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("runQueryRules", () => {
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

  it("returns all rules when no pattern is given", () => {
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(
      join(tmp, "substrate", "RULES.yaml"),
      `rules:
  - id: BE-A
    title: A
    severity: high
  - id: FE-B
    title: B
    severity: medium
`,
    );
    const result = runQueryRules({ cwd: tmp, quiet: true });
    expect(result.rules.map((r) => r.id).sort()).toEqual(["BE-A", "FE-B"]);
    expect(result.warnings).toEqual([]);
  });

  it("filters by --by-prefix glob", () => {
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(
      join(tmp, "substrate", "RULES.yaml"),
      `rules:
  - id: BE-PY-001
    title: A
    severity: high
  - id: BE-API-001
    title: B
    severity: medium
  - id: FE-REACT-001
    title: C
    severity: low
`,
    );
    const result = runQueryRules({
      cwd: tmp,
      byPrefix: ["BE-PY-*"],
      quiet: true,
    });
    expect(result.rules.map((r) => r.id)).toEqual(["BE-PY-001"]);
  });

  it("warns when RULES.yaml is missing", () => {
    const result = runQueryRules({ cwd: tmp, quiet: true });
    expect(result.rules).toEqual([]);
    expect(result.warnings.some((w) => w.includes("RULES.yaml"))).toBe(true);
  });
});

describe("runQueryStandards", () => {
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

  it("lists *.md files under substrate/standards/ with relative paths", () => {
    const root = join(tmp, "substrate", "standards");
    mkdirSync(join(root, "backend"), { recursive: true });
    writeFileSync(join(root, "backend", "python.md"), "# x");
    mkdirSync(join(root, "frontend"), { recursive: true });
    writeFileSync(join(root, "frontend", "react.md"), "# y");
    const result = runQueryStandards({ cwd: tmp, quiet: true });
    expect(result.standards.map((s) => s.relativePath).sort()).toEqual([
      "backend/python.md",
      "frontend/react.md",
    ]);
  });

  it("filters by --pattern glob", () => {
    const root = join(tmp, "substrate", "standards");
    mkdirSync(join(root, "backend"), { recursive: true });
    writeFileSync(join(root, "backend", "python.md"), "# x");
    writeFileSync(join(root, "backend", "api.md"), "# y");
    mkdirSync(join(root, "frontend"), { recursive: true });
    writeFileSync(join(root, "frontend", "react.md"), "# z");
    const result = runQueryStandards({
      cwd: tmp,
      patterns: ["backend/*"],
      quiet: true,
    });
    expect(result.standards.map((s) => s.relativePath).sort()).toEqual([
      "backend/api.md",
      "backend/python.md",
    ]);
  });

  it("warns when no standards root is found", () => {
    const result = runQueryStandards({ cwd: tmp, quiet: true });
    expect(result.standards).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("runQueryMemory (B1 stub)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("returns empty list with a B2-deferred warning", () => {
    const result = runQueryMemory({ quiet: true });
    expect(result.memories).toEqual([]);
    expect(result.warnings[0]).toMatch(/B2/);
  });
});

describe("JSON output shape", () => {
  let tmp: string;
  let stdoutBuf: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    tmp = makeTempDir();
    stdoutBuf = "";
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutBuf += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    removeTempDir(tmp);
  });

  it("emits parseable JSON for query rules", () => {
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(
      join(tmp, "substrate", "RULES.yaml"),
      `rules:
  - id: X-001
    title: x
    severity: medium
`,
    );
    runQueryRules({ cwd: tmp, json: true });
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.rules[0].id).toBe("X-001");
  });

  it("emits parseable JSON for query memory stub", () => {
    runQueryMemory({ json: true });
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.memories).toEqual([]);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });
});
