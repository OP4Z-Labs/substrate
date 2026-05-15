/**
 * Vitest global setup for the integration suite.
 *
 * Ensures `dist/cli.js` is up to date before any integration spec runs.
 * Without this, a stale or missing build would cause the entire
 * integration suite to fail with confusing spawn errors.
 *
 * Runs once per `vitest run` invocation, not per test file or per test.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");

export default async function globalSetup(): Promise<void> {
  // Always rebuild — the build is incremental (tsc -b) so the no-change
  // case is ~150ms. Cheap insurance against running integration tests
  // against a stale dist/.
  const build = spawnSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (build.status !== 0) {
    throw new Error(
      `Integration suite global-setup: \`npm run build\` failed.\n` +
        `stdout:\n${build.stdout}\n\nstderr:\n${build.stderr}`,
    );
  }
  if (!existsSync(CLI_PATH)) {
    throw new Error(
      `Integration suite global-setup: build completed but ${CLI_PATH} is missing.`,
    );
  }
}
