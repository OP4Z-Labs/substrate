/**
 * `audit --diff` must fail safe: when we're in a git repo but git can't resolve
 * the changed-file set, it must NOT silently fall back to auditing the entire
 * repository (the bug that turned a transient git hiccup into a misleading
 * 30k-finding whole-repo report). It should error instead.
 *
 * A genuinely-absent git repo is the one case where a full scan is acceptable
 * — there we only warn.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAuditExecute } from "../src/commands/audit.js";
import { runInit } from "../src/commands/init.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

describe("audit --diff fail-safe", () => {
  let tmp: string;
  let prevCwd: string;
  beforeEach(() => {
    tmp = makeTempDir();
    prevCwd = process.cwd();
    process.chdir(tmp);
    runInit({ projectName: "failsafe", shortCode: "FS", quiet: true });
  });
  afterEach(() => {
    process.chdir(prevCwd);
    removeTempDir(tmp);
  });

  it("refuses to scan the whole repo when git can't resolve the diff", async () => {
    git(["init", "-q"], tmp);
    git(["config", "user.email", "t@e.com"], tmp);
    git(["config", "user.name", "T"], tmp);
    git(["config", "commit.gpgsign", "false"], tmp);
    git(["add", "."], tmp);
    git(["commit", "-q", "-m", "init"], tmp);
    // Corrupt the index so git's file-listing commands fail (stand-in for a
    // stale .git/index.lock or concurrent git op).
    writeFileSync(join(tmp, ".git", "index"), "NOT-A-VALID-GIT-INDEX");

    await expect(
      runAuditExecute({ cwd: tmp, diff: true, quiet: true, noReport: true }),
    ).rejects.toThrow(/Refusing to silently audit/);
  });

  it("only warns (does not throw) when --diff runs outside a git repo", async () => {
    // tmp was scaffolded by runInit but never `git init`-ed.
    await expect(
      runAuditExecute({ cwd: tmp, diff: true, quiet: true, noReport: true }),
    ).resolves.toBeDefined();
  });
});
