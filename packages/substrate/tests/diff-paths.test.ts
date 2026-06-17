/**
 * Tests for listDiffPaths — the `audit --diff` changed-file resolver.
 *
 * The discriminated result (files / no-git / git-error) is what lets the
 * audit command refuse to silently full-scan when git can't resolve the diff.
 * These exercise the real git paths against throwaway repos.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listDiffPaths } from "../src/audit/diff-paths.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function initRepo(dir: string): void {
  git(["init", "-q"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Substrate Test"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
}

describe("listDiffPaths", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("reports no-git outside a git repository", () => {
    expect(listDiffPaths(tmp)).toEqual({ kind: "no-git" });
  });

  it("captures untracked files on an unborn branch (no commits yet)", () => {
    // Previously `git diff HEAD` failed here and collapsed to a full scan.
    initRepo(tmp);
    writeFileSync(join(tmp, "a.py"), "x = 1\n");
    const r = listDiffPaths(tmp);
    expect(r.kind).toBe("files");
    if (r.kind === "files") expect(r.files).toContain("a.py");
  });

  it("returns an empty file list for a clean committed tree", () => {
    initRepo(tmp);
    writeFileSync(join(tmp, "a.py"), "x = 1\n");
    git(["add", "."], tmp);
    git(["commit", "-q", "-m", "init"], tmp);
    const r = listDiffPaths(tmp);
    expect(r).toEqual({ kind: "files", files: [] });
  });

  it("captures both staged and unstaged tracked changes", () => {
    initRepo(tmp);
    writeFileSync(join(tmp, "a.py"), "x = 1\n");
    writeFileSync(join(tmp, "b.py"), "y = 1\n");
    git(["add", "."], tmp);
    git(["commit", "-q", "-m", "init"], tmp);
    writeFileSync(join(tmp, "a.py"), "x = 2\n"); // unstaged
    writeFileSync(join(tmp, "b.py"), "y = 2\n");
    git(["add", "b.py"], tmp); // staged
    const r = listDiffPaths(tmp);
    expect(r.kind).toBe("files");
    if (r.kind === "files") expect(r.files).toEqual(["a.py", "b.py"]);
  });

  it("does not surface gitignored paths (mirrors ripgrep)", () => {
    initRepo(tmp);
    writeFileSync(join(tmp, ".gitignore"), ".claude/\n");
    mkdirSync(join(tmp, ".claude", "worktrees", "x"), { recursive: true });
    writeFileSync(join(tmp, ".claude", "worktrees", "x", "copy.py"), "z = 1\n");
    writeFileSync(join(tmp, "real.py"), "z = 1\n");
    const r = listDiffPaths(tmp);
    expect(r.kind).toBe("files");
    if (r.kind === "files") {
      expect(r.files).toContain("real.py");
      expect(r.files.some((f) => f.includes(".claude"))).toBe(false);
    }
  });
});
