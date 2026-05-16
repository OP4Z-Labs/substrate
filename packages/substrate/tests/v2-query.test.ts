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

  // Regression test for SMOKE-2026-05-15 finding 5: `--for-files` is
  // documented on `query standards` in OP4Z's CLAUDE.md but the flag
  // was previously rejected as "unknown option". The fix is to mirror
  // the `--for-files` shape from `query doc-checks`: file extension /
  // shape → standards-doc scope folder.
  describe("--for-files filter", () => {
    function seedStandards(): string {
      const root = join(tmp, "substrate", "standards");
      mkdirSync(join(root, "backend"), { recursive: true });
      writeFileSync(join(root, "backend", "python.md"), "# python");
      writeFileSync(join(root, "backend", "testing.md"), "# backend testing");
      writeFileSync(join(root, "backend", "database.md"), "# db");
      mkdirSync(join(root, "frontend"), { recursive: true });
      writeFileSync(join(root, "frontend", "react.md"), "# react");
      writeFileSync(join(root, "frontend", "testing.md"), "# frontend testing");
      mkdirSync(join(root, "infrastructure"), { recursive: true });
      writeFileSync(join(root, "infrastructure", "docker.md"), "# docker");
      writeFileSync(join(root, "infrastructure", "ci-cd.md"), "# ci");
      mkdirSync(join(root, "operations"), { recursive: true });
      writeFileSync(join(root, "operations", "database-ops.md"), "# dbops");
      return root;
    }

    it("returns backend standards for a .py change", () => {
      seedStandards();
      const result = runQueryStandards({
        cwd: tmp,
        forFiles: ["apps/backend/foo.py"],
        quiet: true,
      });
      const paths = result.standards.map((s) => s.relativePath).sort();
      expect(paths).toContain("backend/python.md");
      expect(paths).toContain("backend/testing.md");
      // Should NOT include frontend docs.
      expect(paths).not.toContain("frontend/react.md");
    });

    it("returns frontend standards for a .tsx change", () => {
      seedStandards();
      const result = runQueryStandards({
        cwd: tmp,
        forFiles: ["apps/frontend/Button.tsx"],
        quiet: true,
      });
      const paths = result.standards.map((s) => s.relativePath).sort();
      expect(paths).toContain("frontend/react.md");
      expect(paths).not.toContain("backend/python.md");
    });

    it("returns docker standards for Dockerfile changes", () => {
      seedStandards();
      const result = runQueryStandards({
        cwd: tmp,
        forFiles: ["apps/backend/Dockerfile"],
        quiet: true,
      });
      const paths = result.standards.map((s) => s.relativePath);
      expect(paths).toContain("infrastructure/docker.md");
    });

    it("returns ci-cd standards for .github/workflows changes", () => {
      seedStandards();
      const result = runQueryStandards({
        cwd: tmp,
        forFiles: [".github/workflows/ci.yml"],
        quiet: true,
      });
      const paths = result.standards.map((s) => s.relativePath);
      expect(paths).toContain("infrastructure/ci-cd.md");
    });

    it("returns database + ops standards for migration changes", () => {
      seedStandards();
      const result = runQueryStandards({
        cwd: tmp,
        forFiles: ["alembic/versions/abc123_init.py", "schema/users.sql"],
        quiet: true,
      });
      const paths = result.standards.map((s) => s.relativePath);
      expect(paths).toContain("backend/database.md");
      expect(paths).toContain("operations/database-ops.md");
    });

    it("returns the union when multiple file types are passed", () => {
      seedStandards();
      const result = runQueryStandards({
        cwd: tmp,
        forFiles: ["api/handler.py", "ui/Button.tsx"],
        quiet: true,
      });
      const paths = result.standards.map((s) => s.relativePath).sort();
      expect(paths).toContain("backend/python.md");
      expect(paths).toContain("frontend/react.md");
    });

    it("returns empty when no file shape matches any scope", () => {
      seedStandards();
      const result = runQueryStandards({
        cwd: tmp,
        forFiles: ["LICENSE.txt"], // .txt isn't mapped
        quiet: true,
      });
      expect(result.standards).toEqual([]);
    });
  });
});

describe("runQueryMemory (B2: first-class)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let tmp: string;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    tmp = makeTempDir();
  });
  afterEach(() => {
    logSpy.mockRestore();
    removeTempDir(tmp);
  });

  it("returns empty list with a no-store warning when no store is configured", () => {
    // Use a fresh tmp dir with no substrate.config.json memory.path
    // and a tmp homedir override so Claude Code's default also misses.
    const result = runQueryMemory({
      memoryPath: undefined,
      cwd: tmp,
      quiet: true,
    });
    expect(result.memories).toEqual([]);
    expect(result.source).toBe("none");
    expect(result.warnings.some((w) => /No memory store found/.test(w))).toBe(
      true,
    );
  });

  it("reads memories from --memory-path and surfaces them with source=flag", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, "m1.md"),
      `---\nname: m1\ndescription: m1 desc\nmetadata:\n  type: feedback\n  scope: backend\n---\nbody`,
    );
    const result = runQueryMemory({ memoryPath: tmp, quiet: true });
    expect(result.memories.length).toBe(1);
    expect(result.memories[0].name).toBe("m1");
    expect(result.source).toBe("flag");
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

  it("emits parseable JSON for query memory", () => {
    // Pass an empty tmp dir via --memory-path so source is `flag` and
    // memories resolves to []. We avoid relying on the absence of a
    // global memory store.
    runQueryMemory({ memoryPath: tmp, json: true });
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.memories).toEqual([]);
    expect(Array.isArray(parsed.warnings)).toBe(true);
    expect(typeof parsed.source).toBe("string");
  });
});
