/**
 * rg / fallback parity — the divergence battery.
 *
 * The detector's contract is that its two execution paths (real ripgrep, and
 * the Node regex walker used when rg is absent) return the SAME findings for
 * the same inputs. They historically diverged on `detector.paths` handling:
 * rg threw `No such file or directory` on an unexpanded glob while the fallback
 * silently found nothing, and rg would read a `../escape` path while the
 * fallback would not. Path resolution now happens once, before either path
 * runs, so these must agree by construction — this battery is the regression
 * fence that keeps them agreeing.
 *
 * Each case runs the identical detector twice: once with rg (skipped when rg is
 * not installed) and once with `forceFallback: true`, and asserts the finding
 * sets match.
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
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

/** A committed tree so both paths see the same gitignore-respecting file set. */
function buildRepo(root: string): void {
  const files: Record<string, string> = {
    "apps/backend/auth-service/app/services/user.py": "class UserService:\n    pass\n",
    "apps/backend/auth-service/app/api/login.py": "def login(): ...\n",
    "apps/backend/task-service/app/services/task.py": "class TaskService:\n    pass\n",
    "apps/backend/task-service/Dockerfile": "FROM python:3.12\nUSER root\n",
    "docs/readme.md": "class Documentation\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
  git(["init", "-q"], root);
  git(["config", "user.email", "t@e.com"], root);
  git(["config", "user.name", "T"], root);
  git(["add", "-A"], root);
  git(["commit", "-qm", "init"], root);
}

function runBoth(detector: RipgrepDetector, repoRoot: string, pathFilter?: string[]) {
  resetRipgrepProbe();
  resetGitKnownFilesCache();
  const base = { repoRoot, ruleId: "PARITY", severity: "high" as const, pathFilter };
  const fallback = runRipgrepDetector(detector, { ...base, forceFallback: true });
  const rg = RG ? runRipgrepDetector(detector, base) : null;
  return { rg, fallback };
}

function locations(out: { findings: { path?: string; line?: number }[] }): string[] {
  return out.findings.map((f) => `${f.path}:${f.line}`).sort();
}

describe("rg / fallback parity on detector.paths", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    buildRepo(tmp);
  });
  afterEach(() => {
    removeTempDir(tmp);
    resetRipgrepProbe();
    resetGitKnownFilesCache();
  });

  it("agree on a `*` glob that expands to multiple directories", () => {
    const { rg, fallback } = runBoth(
      { type: "ripgrep", pattern: "class \\w+Service", paths: ["apps/backend/*/app/services"] },
      tmp,
    );
    expect(locations(fallback)).toEqual([
      "apps/backend/auth-service/app/services/user.py:1",
      "apps/backend/task-service/app/services/task.py:1",
    ]);
    expect(fallback.unmatched).toEqual([]);
    if (rg) {
      expect(locations(rg)).toEqual(locations(fallback));
      expect(rg.unmatched).toEqual(fallback.unmatched);
    }
  });

  it("agree that a glob matching nothing yields zero findings and one unmatched entry", () => {
    const { rg, fallback } = runBoth(
      { type: "ripgrep", pattern: "anything", paths: ["apps/backend/*/migrations"] },
      tmp,
    );
    expect(fallback.findings).toEqual([]);
    expect(fallback.unmatched).toEqual(["apps/backend/*/migrations"]);
    if (rg) {
      expect(rg.findings).toEqual([]);
      expect(rg.unmatched).toEqual(fallback.unmatched);
    }
  });

  it("agree on refusing a path that escapes the repo root", () => {
    // The historically divergent security case: rg would read the outside file
    // and copy its contents into a snippet; the fallback found nothing.
    const outside = makeTempDir();
    try {
      writeFileSync(join(outside, "secret.env"), "class Secret\nTOKEN=abcdef\n", "utf8");
      const rel = `../${outside.split("/").pop()}/secret.env`;
      const { rg, fallback } = runBoth({ type: "ripgrep", pattern: "TOKEN", paths: [rel] }, tmp);
      expect(fallback.findings).toEqual([]);
      expect(fallback.unmatched).toEqual([rel]);
      if (rg) {
        expect(rg.findings).toEqual([]);
        expect(rg.unmatched).toEqual([rel]);
      }
    } finally {
      removeTempDir(outside);
    }
  });

  it("agree under a pathFilter that intersects the declared scope", () => {
    const changed = [
      "apps/backend/auth-service/app/services/user.py",
      "apps/backend/task-service/Dockerfile",
    ];
    const { rg, fallback } = runBoth(
      { type: "ripgrep", pattern: "class \\w+Service", paths: ["apps/backend/*/app/services"] },
      tmp,
      changed,
    );
    // Only the changed file inside the declared scope is scanned.
    expect(locations(fallback)).toEqual(["apps/backend/auth-service/app/services/user.py:1"]);
    if (rg) expect(locations(rg)).toEqual(locations(fallback));
  });

  it("agree on skipping a symlinked directory during glob expansion", () => {
    symlinkSync(join(tmp, "docs"), join(tmp, "docs-link"), "dir");
    const { rg, fallback } = runBoth(
      { type: "ripgrep", pattern: "class Documentation", paths: ["docs*"] },
      tmp,
    );
    expect(locations(fallback)).toEqual(["docs/readme.md:1"]);
    if (rg) expect(locations(rg)).toEqual(locations(fallback));
  });

  it("agree on a literal (non-glob) directory path", () => {
    const { rg, fallback } = runBoth(
      { type: "ripgrep", pattern: "class", paths: ["docs"] },
      tmp,
    );
    expect(locations(fallback)).toEqual(["docs/readme.md:1"]);
    if (rg) expect(locations(rg)).toEqual(locations(fallback));
  });

  it("agree on a whole-repo scan without a `./` prefix divergence", () => {
    // rg prefixes `./` when scanning `.`; the fallback does not. Both must
    // report the bare relative path so downstream path-filtering agrees.
    const { rg, fallback } = runBoth({ type: "ripgrep", pattern: "class \\w+Service" }, tmp);
    const fbPaths = fallback.findings.map((f) => f.path);
    expect(fbPaths.every((p) => !p!.startsWith("./"))).toBe(true);
    if (rg) {
      expect(rg.findings.map((f) => f.path).every((p) => !p!.startsWith("./"))).toBe(true);
      expect(locations(rg)).toEqual(locations(fallback));
    }
  });
});
