import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Allocate a fresh tmp directory for a test and return its absolute path.
 * Callers should pass this to commands as `cwd` and clean up via `removeTempDir`.
 */
export function makeTempDir(prefix = "cadence-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
