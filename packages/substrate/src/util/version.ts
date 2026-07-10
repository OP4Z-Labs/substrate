/**
 * Canonical version string for the substrate CLI.
 *
 * Resolved from the package's own `package.json` at module load, so it can
 * never drift from the published version. It previously was a hand-maintained
 * literal, and it went stale at `3.0.0-beta.1` for three releases — silently
 * mis-stamping every audit report, trend entry, telemetry event, and init
 * manifest with the wrong version (the trend-discontinuity blind spot, R3 of
 * the detector-integrity plan).
 *
 * Both `src/util/version.ts` and the emitted `dist/util/version.js` sit two
 * levels below the package root, and npm always includes `package.json` in the
 * published tarball, so `../../package.json` resolves in dev, in the built
 * output, and after install. The literal fallback covers the (near-impossible)
 * case where that read fails, and a test pins the resolved value to
 * `package.json` so drift is caught in CI.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Belt-and-suspenders value if package.json cannot be read. Keep in sync with package.json. */
const FALLBACK_VERSION = "3.0.0-beta.6";

function resolveVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "..", "package.json");
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // fall through to the pinned fallback
  }
  return FALLBACK_VERSION;
}

export const SUBSTRATE_VERSION = resolveVersion();
