/**
 * Built-in git VCS adapter.
 *
 * This is the v0.5 default — used whenever `extensions.vcsAdapter` in
 * substrate.config.json is null. Shells out to the `git` binary; no
 * libgit2 / nodegit dependency (the binary is universally available on
 * developer machines and CI runners, and pulling 50MB of native binding
 * for what's effectively `git status --porcelain` is gratuitous).
 *
 * Future SCM adapters (Mercurial, Pijul) implement the same shape — see
 * `src/extensions/vcs-adapter.ts` for the contract.
 */

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import type {
  VcsAdapter,
  VcsCommitInput,
  VcsCommitResult,
  VcsDiffInput,
  VcsStatus,
} from "../extensions/vcs-adapter.js";

const ADAPTER_NAME = "git (built-in)";
const ADAPTER_VERSION = "0.5.0";

interface GitRunOptions {
  cwd?: string;
  /** Don't throw on non-zero exit; surface stderr in the return. */
  allowFailure?: boolean;
}

function runGit(
  args: string[],
  options: GitRunOptions = {},
): { status: number; stdout: string; stderr: string } {
  const spawnOpts: SpawnSyncOptions = {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
  };
  const result = spawnSync("git", args, spawnOpts);
  if (result.error) {
    throw new Error(
      `substrate git adapter: failed to spawn git (${result.error.message}). ` +
        `Is git installed and on PATH?`,
    );
  }
  const stdout = (result.stdout as string | undefined) ?? "";
  const stderr = (result.stderr as string | undefined) ?? "";
  const status = result.status ?? -1;
  if (status !== 0 && !options.allowFailure) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${status}): ${stderr.trim() || stdout.trim()}`,
    );
  }
  return { status, stdout, stderr };
}

async function getStatus(cwd?: string): Promise<VcsStatus> {
  // Branch name.
  const branchRes = runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const branch = branchRes.stdout.trim();

  // Upstream — runs only if one is configured; failure is fine here.
  const upstreamRes = runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd, allowFailure: true },
  );
  const upstream = upstreamRes.status === 0 ? upstreamRes.stdout.trim() : undefined;

  // Working-tree dirty + staged. `git status --porcelain` is the
  // canonical idempotent check.
  const statusRes = runGit(["status", "--porcelain"], { cwd });
  const lines = statusRes.stdout.split("\n").filter((l) => l.trim() !== "");
  const dirty = lines.length > 0;
  // A line is staged when the first character of the porcelain output
  // is a non-space, non-`?` letter (M, A, D, R, C, U).
  const staged = lines.some((l) => /^[MADRCU]/.test(l));

  return { branch, upstream, dirty, staged };
}

async function getBranch(cwd?: string): Promise<string> {
  const res = runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return res.stdout.trim();
}

async function getRemote(
  remoteName = "origin",
  cwd?: string,
): Promise<string | null> {
  const res = runGit(["remote", "get-url", remoteName], {
    cwd,
    allowFailure: true,
  });
  if (res.status !== 0) return null;
  return res.stdout.trim();
}

async function getDiff(
  input: VcsDiffInput = {},
  cwd?: string,
): Promise<string> {
  const args: string[] = ["diff"];
  if (input.stagedOnly) args.push("--cached");
  if (input.base) {
    // `<base>..HEAD` semantics — what's on HEAD that isn't on base.
    args.push(`${input.base}...HEAD`);
  }
  if (input.paths && input.paths.length > 0) {
    args.push("--", ...input.paths);
  }
  const res = runGit(args, { cwd });
  return res.stdout;
}

async function commit(
  input: VcsCommitInput,
  cwd?: string,
): Promise<VcsCommitResult> {
  if (input.paths && input.paths.length > 0) {
    runGit(["add", "--", ...input.paths], { cwd });
  }
  const commitArgs = ["commit", "-m", input.message];
  if (input.allowEmpty) commitArgs.push("--allow-empty");
  runGit(commitArgs, { cwd });
  const shaRes = runGit(["rev-parse", "HEAD"], { cwd });
  const branchRes = runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return {
    sha: shaRes.stdout.trim(),
    branch: branchRes.stdout.trim(),
  };
}

/**
 * Built-in git adapter. Exported as a const (not a class) to match the
 * adapter contract — `isVcsAdapter` checks for object-with-methods shape.
 */
export const gitAdapter: VcsAdapter = {
  name: ADAPTER_NAME,
  version: ADAPTER_VERSION,
  getStatus,
  getBranch,
  getRemote,
  getDiff,
  commit,
};

export default gitAdapter;
