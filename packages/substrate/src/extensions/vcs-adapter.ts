/**
 * Public contract for VCS adapters (v0.5 plugin interface).
 *
 * Mirrors the shape of the task-adapter contract — a small set of verbs
 * any VCS (git, Mercurial, Pijul, future SCMs) can implement. The
 * built-in default adapter (`src/adapters/git.ts`) shells out to the
 * `git` binary; the contract is shaped so that a Mercurial adapter
 * would be drop-in.
 *
 * Why an adapter for git at all (rather than baking shell-outs into
 * commands directly): the `substrate review` family expects to operate on
 * diffs and branches without caring whether they came from git, hg, or
 * a future tool. Pinning to git ergonomics in the command layer would
 * make porting later impossible. The adapter cost is ~150 lines once;
 * the alternative is a fan-out of shell-outs scattered across every
 * review/audit command.
 */

export interface VcsStatus {
  /** Current branch name. */
  branch: string;
  /** Upstream/remote tracking branch, when one is configured. */
  upstream?: string;
  /** Working-tree dirty (uncommitted changes present). */
  dirty: boolean;
  /** True when the working tree has staged changes. */
  staged: boolean;
}

export interface VcsDiffInput {
  /** Base ref to diff against (e.g. "main", "HEAD~3"). Default: "HEAD". */
  base?: string;
  /** Restrict the diff to specific paths. */
  paths?: string[];
  /** Include staged changes only (don't include working-tree diff). */
  stagedOnly?: boolean;
}

export interface VcsCommitInput {
  message: string;
  /** Paths to stage before committing. If undefined, commits the current index. */
  paths?: string[];
  /** Allow an empty commit. */
  allowEmpty?: boolean;
}

export interface VcsCommitResult {
  /** Commit SHA / identifier. */
  sha: string;
  /** Branch the commit landed on. */
  branch: string;
}

export interface VcsAdapter {
  /** Display name, surfaced in `substrate doctor`. */
  readonly name: string;
  /** Semver string (informational). */
  readonly version: string;

  /**
   * Return the current branch + dirty state, or throw if the cwd is
   * not a checkout of this VCS.
   */
  getStatus(cwd?: string): Promise<VcsStatus>;

  /** Current branch name (convenience over getStatus). */
  getBranch(cwd?: string): Promise<string>;

  /** Configured remote URL for the given remote name (default: origin). */
  getRemote(remoteName?: string, cwd?: string): Promise<string | null>;

  /** Unified diff for the input. Implementations should obey VcsDiffInput. */
  getDiff(input?: VcsDiffInput, cwd?: string): Promise<string>;

  /** Create a commit and return its identifier. */
  commit(input: VcsCommitInput, cwd?: string): Promise<VcsCommitResult>;
}

export function isVcsAdapter(value: unknown): value is VcsAdapter {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.version === "string" &&
    typeof v.getStatus === "function" &&
    typeof v.getBranch === "function" &&
    typeof v.getRemote === "function" &&
    typeof v.getDiff === "function" &&
    typeof v.commit === "function"
  );
}
