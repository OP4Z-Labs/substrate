/**
 * Tests for v2 conditional-doc-check registry (Primitive 4).
 *
 * Coverage targets:
 *   - schema validation (valid passes; missing required fields fail)
 *   - discoverer walks substrate/doc-checks/, sorts by id
 *   - findMatchingDocChecks against files-changed-any, commit-message,
 *     branch-pattern
 *   - evaluateDocCheck surfaces `missing` for unsatisfied require clauses
 *   - runQueryDocChecks CLI: registry listing, --for-files evaluation,
 *     --changelog-touched convenience
 *   - glob matcher handles ** segments
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverDocChecks,
  evaluateDocCheck,
  findMatchingDocChecks,
  matchGlob,
  validateDocCheckManifest,
} from "../src/v2/doc-checks.js";
import { runQueryDocChecks } from "../src/v2/deterministic/query-command.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function seedDocCheck(cwd: string, filename: string, content: string): void {
  const dir = join(cwd, "substrate", "doc-checks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

describe("validateDocCheckManifest", () => {
  it("accepts minimal valid manifest", () => {
    const result = validateDocCheckManifest({
      schema_version: "v2.0",
      id: "x",
      when: { "files-changed-any": ["foo/**"] },
      prompt: "Update X",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing when block", () => {
    const result = validateDocCheckManifest({
      schema_version: "v2.0",
      id: "x",
      prompt: "p",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty when block (minProperties=1)", () => {
    const result = validateDocCheckManifest({
      schema_version: "v2.0",
      id: "x",
      when: {},
      prompt: "p",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown severity", () => {
    const result = validateDocCheckManifest({
      schema_version: "v2.0",
      id: "x",
      when: { "files-changed-any": ["a"] },
      prompt: "p",
      severity: "blocker",
    });
    expect(result.ok).toBe(false);
  });
});

describe("discoverDocChecks", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns empty result when dir is missing", () => {
    const result = discoverDocChecks({ cwd: tmp });
    expect(result.docChecks).toEqual([]);
  });

  it("walks substrate/doc-checks/, sorts by id", () => {
    seedDocCheck(
      tmp,
      "z.yaml",
      `schema_version: v2.0\nid: z-check\nwhen:\n  files-changed-any:\n    - x\nprompt: hi\n`,
    );
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a-check\nwhen:\n  files-changed-any:\n    - x\nprompt: hi\n`,
    );
    const result = discoverDocChecks({ cwd: tmp });
    expect(result.docChecks.map((d) => d.manifest.id)).toEqual([
      "a-check",
      "z-check",
    ]);
  });
});

describe("findMatchingDocChecks", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("matches when files-changed-any includes a matching glob", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  files-changed-any:\n    - apps/**\nprompt: p\n`,
    );
    const discovery = discoverDocChecks({ cwd: tmp });
    const matches = findMatchingDocChecks(discovery.docChecks, {
      changedFiles: ["apps/foo/bar.py"],
    });
    expect(matches.length).toBe(1);
  });

  it("does not match when no files-changed-any glob hits", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  files-changed-any:\n    - apps/**\nprompt: p\n`,
    );
    const discovery = discoverDocChecks({ cwd: tmp });
    const matches = findMatchingDocChecks(discovery.docChecks, {
      changedFiles: ["docs/index.md"],
    });
    expect(matches).toEqual([]);
  });

  it("matches commit-message-pattern", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  commit-message-pattern: "^(feat|fix):"\nprompt: p\n`,
    );
    const discovery = discoverDocChecks({ cwd: tmp });
    expect(
      findMatchingDocChecks(discovery.docChecks, {
        changedFiles: [],
        commitMessage: "feat: thing",
      }).length,
    ).toBe(1);
    expect(
      findMatchingDocChecks(discovery.docChecks, {
        changedFiles: [],
        commitMessage: "chore: thing",
      }).length,
    ).toBe(0);
  });

  it("matches branch-pattern", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  branch-pattern: "^feat/"\nprompt: p\n`,
    );
    const discovery = discoverDocChecks({ cwd: tmp });
    expect(
      findMatchingDocChecks(discovery.docChecks, {
        changedFiles: [],
        branch: "feat/x",
      }).length,
    ).toBe(1);
  });
});

describe("evaluateDocCheck", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("reports missing one-of when none is touched", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  files-changed-any:\n    - apps/**\nrequire:\n  one-of:\n    - docs/release-notes.md\n    - docs/changelog.md\nprompt: p\n`,
    );
    const discovery = discoverDocChecks({ cwd: tmp });
    const matches = findMatchingDocChecks(discovery.docChecks, {
      changedFiles: ["apps/x.py"],
    });
    const finding = evaluateDocCheck(matches[0], {
      changedFiles: ["apps/x.py"],
    });
    expect(finding.missing).toBeDefined();
    expect(finding.missing).toContain("docs/release-notes.md");
  });

  it("reports no missing when one-of satisfied", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  files-changed-any:\n    - apps/**\nrequire:\n  one-of:\n    - CHANGELOG.md\nprompt: p\n`,
    );
    const discovery = discoverDocChecks({ cwd: tmp });
    const finding = evaluateDocCheck(discovery.docChecks[0], {
      changedFiles: ["apps/x.py", "CHANGELOG.md"],
    });
    expect(finding.missing).toBeUndefined();
  });

  it("reports missing all-of entries that weren't touched", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  files-changed-any:\n    - apps/**\nrequire:\n  all-of:\n    - docs/A.md\n    - docs/B.md\nprompt: p\n`,
    );
    const discovery = discoverDocChecks({ cwd: tmp });
    const finding = evaluateDocCheck(discovery.docChecks[0], {
      changedFiles: ["apps/x.py", "docs/A.md"],
    });
    expect(finding.missing).toEqual(["docs/B.md"]);
  });
});

describe("matchGlob", () => {
  it("matches ** across many segments", () => {
    expect(matchGlob("apps/**", "apps/foo/bar/baz.py")).toBe(true);
  });
  it("single * does not cross /", () => {
    expect(matchGlob("apps/*", "apps/foo/bar.py")).toBe(false);
    expect(matchGlob("apps/*", "apps/bar.py")).toBe(true);
  });
  it("exact paths match", () => {
    expect(matchGlob("CHANGELOG.md", "CHANGELOG.md")).toBe(true);
  });
});

describe("runQueryDocChecks", () => {
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

  it("returns registry without findings when no forFiles", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  files-changed-any:\n    - apps/**\nprompt: p\n`,
    );
    const result = runQueryDocChecks({ cwd: tmp, quiet: true });
    expect(result.registry.length).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it("returns findings when forFiles matches", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  files-changed-any:\n    - apps/**\nrequire:\n  one-of:\n    - CHANGELOG.md\nprompt: p\nseverity: should-fix\n`,
    );
    const result = runQueryDocChecks({
      cwd: tmp,
      forFiles: ["apps/x.py"],
      quiet: true,
    });
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].missing).toContain("CHANGELOG.md");
  });

  it("--changelog-touched satisfies a changelog one-of", () => {
    seedDocCheck(
      tmp,
      "a.yaml",
      `schema_version: v2.0\nid: a\nwhen:\n  files-changed-any:\n    - apps/**\nrequire:\n  one-of:\n    - CHANGELOG.md\nprompt: p\n`,
    );
    const result = runQueryDocChecks({
      cwd: tmp,
      forFiles: ["apps/x.py"],
      changelogTouched: true,
      quiet: true,
    });
    expect(result.findings[0].missing).toBeUndefined();
  });
});
