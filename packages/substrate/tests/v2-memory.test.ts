/**
 * Tests for v2 first-class memory integration (Primitive 5; plan §6).
 *
 * Coverage targets:
 *   - storage discovery precedence: flag > env > config > Claude Code default > none
 *   - frontmatter parser handles legacy (top-level scalars) AND
 *     extended (metadata: block)
 *   - query filters: types, scope, tags, intersect-with-files
 *   - expired memories drop out of results
 *   - injection format includes age tags + query echo
 *   - encodeProjectPath mirrors Claude Code's `/` → `-` convention
 *   - missing frontmatter generates a "recommended fields missing" warning
 */

import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodeProjectPath,
  locateMemoryDir,
  parseMemoryFrontmatter,
  queryMemory,
  renderMemoryInjection,
} from "../src/v2/memory.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function seedMemory(
  dir: string,
  filename: string,
  content: string,
  mtime?: Date,
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, content);
  if (mtime) {
    utimesSync(path, mtime, mtime);
  }
  return path;
}

describe("encodeProjectPath", () => {
  it("replaces / with - (Claude Code convention)", () => {
    expect(encodeProjectPath("/home/beau/dev/foo")).toBe("-home-beau-dev-foo");
  });
});

describe("locateMemoryDir — precedence", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
    delete process.env.SUBSTRATE_MEMORY_PATH;
  });

  it("flag wins over env", () => {
    const flagDir = join(tmp, "flag-dir");
    mkdirSync(flagDir, { recursive: true });
    const envDir = join(tmp, "env-dir");
    mkdirSync(envDir, { recursive: true });
    process.env.SUBSTRATE_MEMORY_PATH = envDir;
    const result = locateMemoryDir({ memoryPath: flagDir });
    expect(result.path).toBe(flagDir);
    expect(result.source).toBe("flag");
  });

  it("env wins over config", () => {
    const envDir = join(tmp, "env-dir");
    mkdirSync(envDir, { recursive: true });
    const cfgDir = join(tmp, "cfg-dir");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(tmp, "substrate.config.json"),
      JSON.stringify({ memory: { path: cfgDir } }),
    );
    process.env.SUBSTRATE_MEMORY_PATH = envDir;
    const result = locateMemoryDir({ cwd: tmp });
    expect(result.path).toBe(envDir);
    expect(result.source).toBe("env");
  });

  it("config wins over claude-code default when env unset", () => {
    const cfgDir = join(tmp, "cfg-dir");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(tmp, "substrate.config.json"),
      JSON.stringify({ memory: { path: cfgDir } }),
    );
    const result = locateMemoryDir({ cwd: tmp });
    expect(result.path).toBe(cfgDir);
    expect(result.source).toBe("config");
  });

  it("falls back to claude-code default when present", () => {
    const home = makeTempDir();
    const encoded = encodeProjectPath(tmp);
    const claudeDir = join(home, ".claude", "projects", encoded, "memory");
    mkdirSync(claudeDir, { recursive: true });
    const result = locateMemoryDir({ cwd: tmp, homeDir: home });
    expect(result.path).toBe(claudeDir);
    expect(result.source).toBe("claude-code");
    removeTempDir(home);
  });

  it("returns source=none when nothing is configured", () => {
    const home = makeTempDir();
    const result = locateMemoryDir({ cwd: tmp, homeDir: home });
    expect(result.path).toBeNull();
    expect(result.source).toBe("none");
    removeTempDir(home);
  });
});

describe("parseMemoryFrontmatter", () => {
  it("parses legacy Claude Code shape (top-level scalars)", () => {
    const src = `---\nname: feedback-x\ndescription: legacy memory\ntype: feedback\n---\nbody`;
    const { frontmatter, body } = parseMemoryFrontmatter(src);
    expect(frontmatter.name).toBe("feedback-x");
    expect(frontmatter.description).toBe("legacy memory");
    expect(frontmatter.type).toBe("feedback");
    expect(body).toBe("body");
  });

  it("parses extended shape with metadata: block", () => {
    const src = `---\nname: feedback-x\ndescription: extended\nmetadata:\n  type: feedback\n  scope: backend\n  tags:\n    - api\n    - task-tackle\n  applies_to_globs:\n    - apps/backend/**\n---\nbody`;
    const { frontmatter } = parseMemoryFrontmatter(src);
    expect(frontmatter.type).toBe("feedback");
    expect(frontmatter.scope).toBe("backend");
    expect(frontmatter.tags).toEqual(["api", "task-tackle"]);
    expect(frontmatter.applies_to_globs).toEqual(["apps/backend/**"]);
  });

  it("warns when frontmatter lacks recommended fields", () => {
    const src = `---\nname: x\ndescription: y\n---\nbody`;
    const { warnings } = parseMemoryFrontmatter(src);
    expect(
      warnings.some((w) => /recommended substrate fields/.test(w)),
    ).toBe(true);
  });

  it("handles missing frontmatter gracefully", () => {
    const { frontmatter, body, warnings } = parseMemoryFrontmatter(
      "no frontmatter here",
    );
    expect(frontmatter).toEqual({});
    expect(body).toBe("no frontmatter here");
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("queryMemory", () => {
  let tmp: string;
  let home: string;

  beforeEach(() => {
    tmp = makeTempDir();
    home = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmp);
    removeTempDir(home);
    delete process.env.SUBSTRATE_MEMORY_PATH;
  });

  it("returns memories sorted most-recent first", () => {
    const dir = join(tmp, "m");
    seedMemory(
      dir,
      "old.md",
      `---\nname: old\nmetadata:\n  type: feedback\n---\nold body`,
      new Date(2026, 0, 1),
    );
    seedMemory(
      dir,
      "new.md",
      `---\nname: new\nmetadata:\n  type: feedback\n---\nnew body`,
      new Date(2026, 4, 14),
    );
    const result = queryMemory({ memoryPath: dir });
    expect(result.memories.map((m) => m.name)).toEqual(["new", "old"]);
  });

  it("filters by type", () => {
    const dir = join(tmp, "m");
    seedMemory(
      dir,
      "f.md",
      `---\nmetadata:\n  type: feedback\n---\nf`,
    );
    seedMemory(
      dir,
      "p.md",
      `---\nmetadata:\n  type: project\n---\np`,
    );
    const result = queryMemory({ memoryPath: dir, types: ["feedback"] });
    expect(result.memories.map((m) => m.type)).toEqual(["feedback"]);
  });

  it("filters by scope", () => {
    const dir = join(tmp, "m");
    seedMemory(
      dir,
      "be.md",
      `---\nmetadata:\n  type: feedback\n  scope: backend\n---\nbe`,
    );
    seedMemory(
      dir,
      "fe.md",
      `---\nmetadata:\n  type: feedback\n  scope: frontend\n---\nfe`,
    );
    const result = queryMemory({ memoryPath: dir, scope: "backend" });
    expect(result.memories.map((m) => m.scope)).toEqual(["backend"]);
  });

  it("filters by tags (AND semantics)", () => {
    const dir = join(tmp, "m");
    seedMemory(
      dir,
      "a.md",
      `---\nmetadata:\n  type: feedback\n  tags:\n    - api\n    - task-tackle\n---\nx`,
    );
    seedMemory(
      dir,
      "b.md",
      `---\nmetadata:\n  type: feedback\n  tags:\n    - api\n---\ny`,
    );
    const result = queryMemory({
      memoryPath: dir,
      tags: ["api", "task-tackle"],
    });
    expect(result.memories.length).toBe(1);
  });

  it("intersect-with-files: keeps globless memories + glob-matching memories", () => {
    const dir = join(tmp, "m");
    seedMemory(
      dir,
      "globless.md",
      `---\nmetadata:\n  type: feedback\n---\ng`,
    );
    seedMemory(
      dir,
      "backend.md",
      `---\nmetadata:\n  type: feedback\n  applies_to_globs:\n    - apps/backend/**\n---\nbe`,
    );
    seedMemory(
      dir,
      "frontend.md",
      `---\nmetadata:\n  type: feedback\n  applies_to_globs:\n    - apps/frontend/**\n---\nfe`,
    );
    const result = queryMemory({
      memoryPath: dir,
      intersectWithFiles: ["apps/backend/users/api.py"],
    });
    expect(result.memories.map((m) => m.name).sort()).toEqual([
      "backend",
      "globless",
    ]);
  });

  it("drops expired memories", () => {
    const dir = join(tmp, "m");
    seedMemory(
      dir,
      "expired.md",
      `---\nmetadata:\n  type: feedback\n  expires: "2020-01-01"\n---\nold`,
    );
    seedMemory(
      dir,
      "valid.md",
      `---\nmetadata:\n  type: feedback\n  expires: "2099-01-01"\n---\nnew`,
    );
    const result = queryMemory({
      memoryPath: dir,
      now: new Date("2026-05-15"),
    });
    expect(result.memories.map((m) => m.name)).toEqual(["valid"]);
  });

  it("reports source=none with a warning when no store exists", () => {
    const result = queryMemory({ cwd: tmp, homeDir: home });
    expect(result.memories).toEqual([]);
    expect(result.source).toBe("none");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("renderMemoryInjection", () => {
  it("returns empty string for no memories", () => {
    expect(renderMemoryInjection([])).toBe("");
  });

  it("renders the canonical injection block", () => {
    const out = renderMemoryInjection(
      [
        {
          name: "feedback-x",
          path: "/m/feedback-x.md",
          body: "body content",
          ageDays: 12,
          mtimeMs: 0,
          warnings: [],
        },
      ],
      { types: ["feedback"], scope: "backend", tags: ["api"] },
    );
    expect(out).toContain("Relevant prior decisions and feedback");
    expect(out).toContain("Verify accuracy");
    expect(out).toContain("feedback-x");
    expect(out).toContain("12 days ago");
    expect(out).toContain("types=feedback");
    expect(out).toContain("scope=backend");
    expect(out).toContain("tags=api");
  });

  it("uses singular '1 day ago' for age=1", () => {
    const out = renderMemoryInjection([
      {
        name: "m",
        path: "/m.md",
        body: "b",
        ageDays: 1,
        mtimeMs: 0,
        warnings: [],
      },
    ]);
    expect(out).toContain("1 day ago");
  });
});

// OP-1374 #2: the memory loader treats every .md in the memory dir as
// a memory needing frontmatter, including Claude Code's `MEMORY.md`
// index file. This made `substrate doctor` warn "1 memory missing
// frontmatter" on every consumer. The loader now ignores `MEMORY.md`,
// `README.md`, `INDEX.md` by default and accepts additional names via
// `substrate.config.json` `memory.ignore`.
describe("queryMemory — index file ignore list (OP-1374 #2)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
    delete process.env.SUBSTRATE_MEMORY_PATH;
  });

  it("skips MEMORY.md by default (the Claude Code index file)", () => {
    const dir = join(tmp, "mem");
    seedMemory(
      dir,
      "MEMORY.md",
      // No frontmatter — this is what Claude Code writes for its index.
      "# Memory Index\n\n- [foo](feedback_foo.md) — short blurb\n",
    );
    seedMemory(
      dir,
      "feedback_foo.md",
      `---
name: feedback_foo
description: a real memory
metadata:
  type: feedback
  scope: backend
  tags: [api]
---

# body
`,
    );
    const result = queryMemory({ memoryPath: dir });
    expect(result.memories.length).toBe(1);
    expect(result.memories[0].name).toBe("feedback_foo");
    // The skipped MEMORY.md must not produce a frontmatter warning.
    for (const m of result.memories) {
      expect(m.warnings).toEqual([]);
    }
  });

  it("skips README.md and INDEX.md by default", () => {
    const dir = join(tmp, "mem");
    seedMemory(dir, "README.md", "# Welcome\n");
    seedMemory(dir, "INDEX.md", "# Index\n");
    seedMemory(
      dir,
      "feedback_bar.md",
      `---
metadata:
  type: feedback
---

body
`,
    );
    const result = queryMemory({ memoryPath: dir });
    const names = result.memories.map((m) => m.name);
    expect(names).toEqual(["feedback_bar"]);
  });

  it("matches ignore names case-insensitively", () => {
    const dir = join(tmp, "mem");
    seedMemory(dir, "memory.md", "# index\n");
    seedMemory(dir, "Memory.md", "# index\n");
    seedMemory(
      dir,
      "real.md",
      `---
metadata:
  type: feedback
---

body
`,
    );
    const result = queryMemory({ memoryPath: dir });
    const names = result.memories.map((m) => m.name);
    expect(names).toEqual(["real"]);
  });

  it("honors `ignore` from substrate.config.json memory.ignore", () => {
    const dir = join(tmp, "mem");
    seedMemory(
      dir,
      "PROJECT-INDEX.md",
      "# Project specific index\n",
    );
    seedMemory(
      dir,
      "feedback_x.md",
      `---
metadata:
  type: feedback
---

body
`,
    );
    writeFileSync(
      join(tmp, "substrate.config.json"),
      JSON.stringify({ memory: { ignore: ["PROJECT-INDEX.md"] } }),
    );
    const result = queryMemory({ memoryPath: dir, cwd: tmp });
    const names = result.memories.map((m) => m.name);
    expect(names).toEqual(["feedback_x"]);
  });

  it("honors the in-process `ignore` option (additive on top of defaults + config)", () => {
    const dir = join(tmp, "mem");
    seedMemory(dir, "CUSTOM.md", "# extra index\n");
    seedMemory(
      dir,
      "real.md",
      `---
metadata:
  type: feedback
---

body
`,
    );
    const result = queryMemory({
      memoryPath: dir,
      ignore: ["CUSTOM.md"],
    });
    const names = result.memories.map((m) => m.name);
    expect(names).toEqual(["real"]);
  });

  it("regression: MEMORY.md alongside real memories doesn't trigger a frontmatter warning", () => {
    // Reproduce the exact OP-1374 #2 scenario: Claude Code-managed
    // MEMORY.md index file in the same dir as real memories. The
    // doctor's aggregation reads memory entry warnings, so the
    // critical assertion is that the MEMORY.md doesn't even surface
    // as a memory.
    const dir = join(tmp, "mem");
    seedMemory(
      dir,
      "MEMORY.md",
      "# Memory Index\n\n- [a](real_a.md)\n",
    );
    seedMemory(
      dir,
      "real_a.md",
      `---
metadata:
  type: feedback
---
hello
`,
    );
    const result = queryMemory({ memoryPath: dir });
    const offending = result.memories.filter(
      (m) => (m.warnings ?? []).length > 0,
    );
    expect(offending).toEqual([]);
  });
});
