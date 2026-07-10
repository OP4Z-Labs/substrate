/**
 * `substrate audit --strict` exit-code contract (U3).
 *
 * Default mode stays exit 0 even with detector errors, for backward
 * compatibility — existing callers of `substrate audit` must not start
 * failing. `--strict` turns a detector error into a non-zero exit so a caller
 * can gate on the exit code alone, without parsing JSON.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAuditExecute } from "../src/commands/audit.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

/** One firing rule + one rule whose pattern cannot compile (a detector error). */
function writeRulesWithAnError(dir: string): string {
  const p = join(dir, "RULES.yaml");
  writeFileSync(
    p,
    [
      "rules:",
      "  - id: FIRES-001",
      "    title: fires",
      "    severity: high",
      "    detector:",
      "      type: ripgrep",
      "      pattern: NEEDLE",
      "  - id: ERRORS-001",
      "    title: cannot compile",
      "    severity: critical",
      "    detector:",
      "      type: ripgrep",
      "      pattern: '['",
    ].join("\n"),
    "utf8",
  );
  return p;
}

describe("audit --strict exit code", () => {
  let tmp: string;
  let savedExitCode: typeof process.exitCode;
  beforeEach(() => {
    tmp = makeTempDir();
    writeFileSync(join(tmp, "src.txt"), "NEEDLE\n", "utf8");
    savedExitCode = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    removeTempDir(tmp);
    process.exitCode = savedExitCode;
  });

  it("exits non-zero under --strict when a rule errored", async () => {
    const rulesPath = writeRulesWithAnError(tmp);
    const { report } = await runAuditExecute({
      cwd: tmp,
      rulesPath,
      strict: true,
      quiet: true,
      noReport: true,
    });
    expect(report.errors.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  it("stays exit 0 without --strict even when a rule errored", async () => {
    const rulesPath = writeRulesWithAnError(tmp);
    const { report } = await runAuditExecute({
      cwd: tmp,
      rulesPath,
      quiet: true,
      noReport: true,
    });
    expect(report.errors.length).toBeGreaterThan(0);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("stays exit 0 under --strict when no rule errored", async () => {
    const p = join(tmp, "clean.yaml");
    writeFileSync(
      p,
      ["rules:", "  - id: OK-1", "    title: ok", "    severity: low", "    detector:", "      type: ripgrep", "      pattern: NEEDLE"].join("\n"),
      "utf8",
    );
    const { report } = await runAuditExecute({
      cwd: tmp,
      rulesPath: p,
      strict: true,
      quiet: true,
      noReport: true,
    });
    expect(report.errors).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
