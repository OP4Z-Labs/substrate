/**
 * `audit --diff` support — list the files changed in the working tree.
 *
 * Strategy: `git diff --name-only HEAD` plus `git ls-files --others
 * --exclude-standard` to capture untracked files. The combined set is
 * what `--diff` runs the rules against.
 *
 * If we're not inside a git repo (or git isn't available), the function
 * returns null so the runner can degrade to running against everything
 * with a warning.
 */

import { spawnSync } from "node:child_process";

export function listDiffPaths(repoRoot: string): string[] | null {
  if (!isGitRepo(repoRoot)) return null;
  const tracked = gitOutput(repoRoot, ["diff", "--name-only", "HEAD"]);
  const untracked = gitOutput(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  if (tracked === null && untracked === null) return null;
  const set = new Set<string>();
  for (const part of [tracked ?? "", untracked ?? ""]) {
    for (const line of part.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return Array.from(set).sort();
}

function isGitRepo(cwd: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdio: "ignore",
  });
  return r.status === 0;
}

function gitOutput(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout ?? "";
}
