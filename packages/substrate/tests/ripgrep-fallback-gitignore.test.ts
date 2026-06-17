/**
 * The Node fallback walker (used when ripgrep is absent, or per-rule when rg
 * can't compile a pattern) must produce the same findings as the rg path —
 * "divergence between them is a bug" per the detector's own contract.
 *
 * The historically-divergent case: rg respects `.gitignore` natively, but the
 * fallback walked everything subject only to its hardcoded exclude globs — so
 * it descended into gitignored agent worktrees (full repo copies), multiplying
 * findings. These tests pin the fallback to gitignore semantics.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resetGitKnownFilesCache,
  runRipgrepDetector,
} from "../src/audit/detectors/ripgrep.js";
import type { RipgrepDetector } from "../src/audit/types.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

const DETECTOR: RipgrepDetector = { type: "ripgrep", pattern: "NEEDLE" };

describe("ripgrep fallback respects .gitignore", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    resetGitKnownFilesCache();
  });
  afterEach(() => {
    removeTempDir(tmp);
    resetGitKnownFilesCache();
  });

  it("skips files inside gitignored directories (e.g. worktrees)", () => {
    git(["init", "-q"], tmp);
    writeFileSync(join(tmp, ".gitignore"), ".claude/\n");
    writeFileSync(join(tmp, "tracked.py"), "NEEDLE here\n");
    mkdirSync(join(tmp, ".claude", "worktrees", "agent-1"), { recursive: true });
    writeFileSync(
      join(tmp, ".claude", "worktrees", "agent-1", "copy.py"),
      "NEEDLE here too\n",
    );

    const findings = runRipgrepDetector(DETECTOR, {
      repoRoot: tmp,
      ruleId: "TEST-001",
      severity: "medium",
      forceFallback: true,
    });

    const paths = findings.map((f) => f.path);
    expect(paths).toContain("tracked.py");
    expect(paths.some((p) => p.includes(".claude"))).toBe(false);
  });

  it("still finds matches in tracked and untracked-not-ignored files", () => {
    git(["init", "-q"], tmp);
    writeFileSync(join(tmp, ".gitignore"), "ignored.py\n");
    writeFileSync(join(tmp, "committed.py"), "NEEDLE\n");
    git(["config", "user.email", "t@e.com"], tmp);
    git(["config", "user.name", "T"], tmp);
    git(["config", "commit.gpgsign", "false"], tmp);
    git(["add", "committed.py", ".gitignore"], tmp);
    git(["commit", "-q", "-m", "init"], tmp);
    writeFileSync(join(tmp, "untracked.py"), "NEEDLE\n"); // untracked, not ignored
    writeFileSync(join(tmp, "ignored.py"), "NEEDLE\n"); // gitignored

    const findings = runRipgrepDetector(DETECTOR, {
      repoRoot: tmp,
      ruleId: "TEST-002",
      severity: "medium",
      forceFallback: true,
    });

    const paths = findings.map((f) => f.path).sort();
    expect(paths).toContain("committed.py");
    expect(paths).toContain("untracked.py");
    expect(paths).not.toContain("ignored.py");
  });
});
