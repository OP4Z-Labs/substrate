/**
 * Fixes for the beta.6 adversarial smoke pass — all in the Node fallback engine.
 *
 * 1. [CRITICAL] the fallback walk followed an in-tree symlink pointing outside
 *    the repo (when git was unavailable to bound the file set), exfiltrating
 *    outside-repo content into a finding snippet.
 * 2. [HIGH] POSIX bracket classes (`[[:space:]]`) silently matched nothing on
 *    the JS-RegExp fallback — real rules reported false-clean without rg.
 * 3. [MED] hidden-file divergence: rg skipped dotfiles without `--hidden`.
 * 4. [MED] the multiline fallback reported at most one match per file.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resetGitKnownFilesCache,
  resetRipgrepProbe,
  runRipgrepDetector,
} from "../src/audit/detectors/ripgrep.js";
import type { RipgrepDetector } from "../src/audit/types.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function hasRg(): boolean {
  try {
    return spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}
const RG = hasRg();

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function run(detector: RipgrepDetector, repoRoot: string, forceFallback: boolean) {
  resetRipgrepProbe();
  resetGitKnownFilesCache();
  return runRipgrepDetector(detector, { repoRoot, ruleId: "T", severity: "high", forceFallback });
}

describe("fallback: symlink exfiltration is refused (CRITICAL)", () => {
  let tmp: string;
  let outside: string;
  beforeEach(() => {
    tmp = makeTempDir();
    outside = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
    removeTempDir(outside);
    resetGitKnownFilesCache();
    resetRipgrepProbe();
  });

  it("does not read a file reached through an in-tree symlink when git is absent", () => {
    // tmp is NOT a git repo, so the git-known-files guard is null — the only
    // thing that can stop the exfil is the walk's symlink skip.
    writeFileSync(join(outside, "secret.env"), "TOKEN=SUPERSECRET_abc123\n", "utf8");
    mkdirSync(join(tmp, "apps"), { recursive: true });
    writeFileSync(join(tmp, "apps", "clean.ts"), "const ok = true;\n", "utf8");
    symlinkSync(outside, join(tmp, "apps", "evil"), "dir");

    const det: RipgrepDetector = { type: "ripgrep", pattern: "TOKEN", paths: ["apps"] };
    const fb = run(det, tmp, true);
    // No finding, and absolutely no outside-repo content in any snippet.
    expect(fb.findings).toEqual([]);
    const blob = JSON.stringify(fb);
    expect(blob).not.toContain("SUPERSECRET");
    if (RG) expect(run(det, tmp, false).findings).toEqual([]);
  });
});

describe("fallback: POSIX bracket classes (HIGH)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
    resetGitKnownFilesCache();
    resetRipgrepProbe();
  });

  it("matches `[[:space:]]` on the fallback the same as rg", () => {
    writeFileSync(join(tmp, "a.py"), "    print(1)\nx = 2\n\tprint(2)\n", "utf8");
    const det: RipgrepDetector = { type: "ripgrep", pattern: "^[[:space:]]*print\\(", paths: ["a.py"] };
    const fb = run(det, tmp, true);
    expect(fb.findings.map((f) => f.line).sort()).toEqual([1, 3]);
    if (RG) {
      const rg = run(det, tmp, false);
      expect(rg.findings.map((f) => f.line).sort()).toEqual(fb.findings.map((f) => f.line).sort());
    }
  });

  it("fails loud on a POSIX class it cannot translate rather than mismatching", () => {
    writeFileSync(join(tmp, "a.txt"), "x\n", "utf8");
    const det: RipgrepDetector = { type: "ripgrep", pattern: "[[:bogus:]]", paths: ["a.txt"] };
    // A pattern the fallback cannot faithfully evaluate throws — the runner
    // records that as a detector error, never a silent zero-finding pass.
    expect(() => run(det, tmp, true)).toThrow(/POSIX class/);
  });
});

describe("fallback: hidden files + multiline (MED)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    git(["init", "-q"], tmp);
    git(["config", "user.email", "t@e.com"], tmp);
    git(["config", "user.name", "T"], tmp);
  });
  afterEach(() => {
    removeTempDir(tmp);
    resetGitKnownFilesCache();
    resetRipgrepProbe();
  });

  it("both engines scan a tracked dotfile", () => {
    mkdirSync(join(tmp, ".github"), { recursive: true });
    writeFileSync(join(tmp, ".github", "ci.yml"), "run: NEEDLE\n", "utf8");
    writeFileSync(join(tmp, "src.txt"), "NEEDLE\n", "utf8");
    git(["add", "-A"], tmp);
    git(["commit", "-qm", "x"], tmp);

    const det: RipgrepDetector = { type: "ripgrep", pattern: "NEEDLE" };
    const fb = run(det, tmp, true).findings.map((f) => f.path).sort();
    expect(fb).toContain(".github/ci.yml");
    if (RG) {
      const rg = run(det, tmp, false).findings.map((f) => f.path).sort();
      expect(rg).toEqual(fb);
    }
  });

  it("multiline reports every match in a file, not just the first", () => {
    writeFileSync(
      join(tmp, "m.py"),
      "def a():\n    pass  # downgrade\n\ndef b():\n    pass  # downgrade\n",
      "utf8",
    );
    git(["add", "-A"], tmp);
    git(["commit", "-qm", "m"], tmp);

    const det: RipgrepDetector = {
      type: "ripgrep",
      pattern: "pass  # downgrade",
      multiline: true,
      paths: ["m.py"],
    };
    const fb = run(det, tmp, true);
    expect(fb.findings).toHaveLength(2);
    if (RG) expect(run(det, tmp, false).findings.length).toBe(2);
  });
});
