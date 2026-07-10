/**
 * `SUBSTRATE_VERSION` must equal the package's own `package.json` version.
 *
 * The constant was a hand-maintained literal that went stale at
 * `3.0.0-beta.1` for three releases, silently mis-stamping every report and
 * telemetry event. It is now resolved from package.json; this test is the
 * fence that keeps the resolution honest and catches a broken read (which
 * would fall back to the pinned literal and drift).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SUBSTRATE_VERSION } from "../src/util/version.js";

describe("version parity", () => {
  it("SUBSTRATE_VERSION matches package.json", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version: string;
    };
    expect(SUBSTRATE_VERSION).toBe(pkg.version);
  });

  it("looks like a semver string", () => {
    expect(SUBSTRATE_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
