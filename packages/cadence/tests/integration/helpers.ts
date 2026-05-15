/**
 * Integration-test harness for the `cadence` CLI binary.
 *
 * Design decisions (locked 2026-05-14 v0.3.1):
 *
 * 1. **Spawn `dist/cli.js` via `node`, not `tsx src/cli.ts`.**
 *    Integration tests exist to catch bugs the unit suite structurally
 *    can't — the canonical example is the v0.3 symlink bug (commit
 *    `3995a60`): 84 unit tests passed cleanly while `cadence --help`
 *    silently no-op'd on the global-bin install path. Exercising the
 *    actual built artifact (`dist/cli.js`) is the only way to catch
 *    that class of bug. `tsx`-direct would re-test the source, not the
 *    distribution.
 *
 * 2. **One fresh tmp dir per test via `fs.mkdtempSync`.**
 *    No process.chdir() — the CLI accepts an explicit cwd by way of
 *    `spawnSync(..., { cwd })`, which is also the shape that catches
 *    cwd-leak bugs (commands accidentally reading from the test
 *    runner's repo instead of the target).
 *
 * 3. **Synchronous spawn (`spawnSync`).**
 *    No need for async I/O — every cadence command is a one-shot.
 *    Synchronous tests are simpler to reason about and don't need
 *    extra `await`-juggling.
 *
 * 4. **No new prod / dev deps for the harness.**
 *    Pure Node stdlib (`node:child_process`, `node:fs`, `node:os`,
 *    `node:path`). Same pattern the unit-test helpers already use.
 *
 * 5. **Build is a prerequisite, not a per-test side effect.**
 *    `tests/integration/global-setup.ts` runs `npm run build` once at
 *    the start of the integration run. Per-test builds would balloon
 *    runtime ~100x and serve no purpose — the artifact doesn't change
 *    between two tests in the same run.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

/** Absolute path of the built CLI entry point. */
export const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");

/** Absolute path of the repo root (useful for resolving template fixtures). */
export const CADENCE_REPO_ROOT = REPO_ROOT;

export interface CliRunOptions {
  /** Working directory the CLI is spawned in. Required. */
  cwd: string;
  /** Extra env vars layered on top of process.env. */
  env?: NodeJS.ProcessEnv;
  /** Max wall time the spawn is allowed (ms). Default: 30s. */
  timeoutMs?: number;
}

export interface CliRunResult {
  status: number;
  stdout: string;
  stderr: string;
  /** Combined stdout + stderr, useful for assertions that don't care which stream. */
  output: string;
  /** The raw spawn result for advanced assertions. */
  raw: SpawnSyncReturns<string>;
}

/**
 * Spawn the built cadence CLI with the given argv.
 *
 * Stays synchronous and returns the captured output. Throws ONLY if
 * Node failed to spawn the process at all (missing binary, etc.) — a
 * non-zero exit code is a normal result and surfaces in
 * `result.status` so tests can assert on it.
 */
export function runCli(args: string[], options: CliRunOptions): CliRunResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    timeout: options.timeoutMs ?? 30000,
  });

  // spawnSync sets `error` for spawn-level failures (ENOENT etc.). Surface
  // these eagerly so a missing dist/ build is loud rather than presenting
  // as a generic "exit code 1, empty output" result.
  if (result.error) {
    throw new Error(
      `Failed to spawn cadence CLI: ${result.error.message}. ` +
        `Ensure \`npm run build\` has been run and dist/cli.js exists.`,
    );
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    status: result.status ?? -1,
    stdout,
    stderr,
    output: stdout + stderr,
    raw: result,
  };
}

/**
 * Allocate a fresh tmp directory for a single integration test.
 *
 * Uses a `cadence-int-` prefix so collateral on the OS tmpdir is
 * trivial to identify and purge. Callers should pair every `makeTmpDir`
 * with a `removeTmpDir` in `afterEach`.
 */
export function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "cadence-int-"));
}

export function removeTmpDir(path: string): void {
  // `force: true` means a partial-cleanup tmp dir won't fail the suite.
  rmSync(path, { recursive: true, force: true });
}
