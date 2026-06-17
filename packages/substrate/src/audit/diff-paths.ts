/**
 * `audit --diff` support — list the files changed in the working tree.
 *
 * Strategy: `git diff --name-only HEAD` (tracked changes, staged + unstaged)
 * plus `git ls-files --others --exclude-standard` (untracked, gitignore-aware).
 * The combined set is what `--diff` runs the rules against.
 *
 * The result is a discriminated union so the caller can tell the three
 * outcomes apart — this matters because they demand different behavior:
 *   - `files`     : resolved cleanly (the list may be empty = nothing changed).
 *   - `no-git`    : not inside a git work tree; `--diff` can't scope, caller
 *                   may degrade to a full scan (but should say so).
 *   - `git-error` : we ARE in a repo but a git command failed (e.g. a stale
 *                   `.git/index.lock`, concurrent git op). The caller MUST NOT
 *                   silently fall back to scanning everything — that turns a
 *                   transient git hiccup into a misleading whole-repo audit.
 */

import { spawnSync } from "node:child_process";

export type DiffPaths =
  | { kind: "files"; files: string[] }
  | { kind: "no-git" }
  | { kind: "git-error"; detail: string };

export function listDiffPaths(repoRoot: string): DiffPaths {
  if (!isGitRepo(repoRoot)) return { kind: "no-git" };

  const files = new Set<string>();

  // Untracked files, respecting .gitignore via --exclude-standard.
  const untracked = gitRun(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked.status !== 0) {
    return { kind: "git-error", detail: describeFailure("git ls-files", untracked) };
  }
  addLines(files, untracked.stdout);

  // Tracked changes vs HEAD — but only when HEAD exists. On an unborn branch
  // (a freshly-init'd repo with no commits) `git diff HEAD` legitimately
  // fails; there everything is untracked and already captured above.
  if (hasHead(repoRoot)) {
    const tracked = gitRun(repoRoot, ["diff", "--name-only", "HEAD"]);
    if (tracked.status !== 0) {
      return { kind: "git-error", detail: describeFailure("git diff", tracked) };
    }
    addLines(files, tracked.stdout);
  }

  return { kind: "files", files: Array.from(files).sort() };
}

function addLines(set: Set<string>, stdout: string): void {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) set.add(trimmed);
  }
}

function isGitRepo(cwd: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdio: "ignore",
  });
  return r.status === 0;
}

function hasHead(cwd: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
    cwd,
    stdio: "ignore",
  });
  return r.status === 0;
}

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function gitRun(cwd: string, args: string[]): GitResult {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: r.error ? 1 : r.status,
    stdout: r.stdout ?? "",
    stderr: r.error ? r.error.message : (r.stderr ?? ""),
  };
}

function describeFailure(label: string, r: GitResult): string {
  const reason = r.stderr.trim() || `exit ${r.status}`;
  return `${label} failed: ${reason}`;
}
