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
const STUB_PATH = join(
  REPO_ROOT,
  "packages",
  "adapter-stub",
  "dist",
  "index.js",
);

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

  // v0.5: build the reference stub adapter so the adapter integration
  // tests can load it via absolute path. The stub lives outside cadence's
  // main tsbuildinfo graph (separate tsconfig + dist) so it needs its
  // own build invocation.
  const stubBuild = spawnSync("npx", ["tsc"], {
    cwd: join(REPO_ROOT, "packages", "adapter-stub"),
    encoding: "utf8",
    stdio: "pipe",
  });
  if (stubBuild.status !== 0) {
    throw new Error(
      `Integration suite global-setup: stub adapter build failed.\n` +
        `stdout:\n${stubBuild.stdout}\n\nstderr:\n${stubBuild.stderr}`,
    );
  }
  if (!existsSync(STUB_PATH)) {
    throw new Error(
      `Integration suite global-setup: stub build completed but ${STUB_PATH} is missing.`,
    );
  }
}
