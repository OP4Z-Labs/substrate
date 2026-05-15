/**
 * Tests for the doctor memory-frontmatter aggregation slice
 * (Phase B3, rolled in from B2).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/commands/doctor.js";
import { runInit } from "../src/commands/init.js";

let tmpRoot: string;
let memDir: string;
let previousCwd: string;
let previousEnv: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-doctor-mem-"));
  previousCwd = process.cwd();
  process.chdir(tmpRoot);
  runInit({ projectName: "doc-mem", shortCode: "DM", quiet: true });
  memDir = join(tmpRoot, "memories");
  mkdirSync(memDir, { recursive: true });
  previousEnv = process.env.SUBSTRATE_MEMORY_PATH;
  process.env.SUBSTRATE_MEMORY_PATH = memDir;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  if (previousEnv === undefined) {
    delete process.env.SUBSTRATE_MEMORY_PATH;
  } else {
    process.env.SUBSTRATE_MEMORY_PATH = previousEnv;
  }
  process.chdir(previousCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  process.exitCode = 0;
});

function writeMemory(name: string, frontmatter: string, body = "body"): void {
  writeFileSync(
    join(memDir, `${name}.md`),
    `---\n${frontmatter}\n---\n\n${body}\n`,
    "utf8",
  );
}

describe("substrate doctor — memory frontmatter aggregation", () => {
  it("severity=ok when all memories carry recommended fields", () => {
    writeMemory(
      "first",
      `name: first
description: A complete memory.
metadata:
  type: feedback
  scope: backend
  tags: [api]
`,
    );
    const report = runDoctor();
    const check = report.checks.find((c) => c.id === "memory.frontmatter");
    expect(check?.severity).toBe("ok");
    expect(check?.message).toMatch(/all carry recommended substrate frontmatter/);
  });

  it("severity=warn with count + examples when some memories lack recommended fields", () => {
    writeMemory(
      "good",
      `name: good
description: complete
metadata:
  type: feedback
  scope: backend
  tags: [a]
`,
    );
    writeMemory("bare", `name: bare\ndescription: minimal\n`);
    writeMemory("alsobare", `name: alsobare\ndescription: also minimal\n`);
    const report = runDoctor();
    const check = report.checks.find((c) => c.id === "memory.frontmatter");
    expect(check?.severity).toBe("warn");
    expect(check?.message).toMatch(/2 of 3 memories/);
    expect(check?.fix).toMatch(/metadata\.type/);
  });

  it("severity=ok with informational message when no memory store discovered", () => {
    // Clear the env and Claude Code home so locateMemoryDir falls
    // through to "none".
    delete process.env.SUBSTRATE_MEMORY_PATH;
    const report = runDoctor();
    const check = report.checks.find((c) => c.id === "memory.store");
    expect(check?.severity).toBe("ok");
    expect(check?.message).toMatch(/no memory store discovered/);
  });

  it("--json includes the memory-frontmatter check", () => {
    writeMemory(
      "first",
      `name: first
description: complete
metadata:
  type: feedback
  scope: backend
  tags: [api]
`,
    );
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const report = runDoctor({ json: true });
      const ids = report.checks.map((c) => c.id);
      expect(ids).toContain("memory.frontmatter");
      // First write call carries the rendered JSON
      const written = writeSpy.mock.calls[0]?.[0] as string;
      expect(written).toContain('"memory.frontmatter"');
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("caps the example list at 5 with a `…N more` suffix", () => {
    for (let i = 0; i < 8; i += 1) {
      writeMemory(`bare-${i}`, `name: bare-${i}\ndescription: minimal\n`);
    }
    const report = runDoctor();
    const check = report.checks.find((c) => c.id === "memory.frontmatter");
    expect(check?.severity).toBe("warn");
    expect(check?.message).toMatch(/8 of 8/);
    expect(check?.message).toMatch(/…3 more/);
  });
});
