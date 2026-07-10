/**
 * OP-2086 — a corrupt repo-local RULES.yaml must fail closed.
 *
 * The extends merge downgrades a per-layer load error to a warning and
 * continues, which for the primary registry means a totalRules: 0, exit-0
 * report: a broken registry reporting all-clean. The audit now re-loads the
 * repo-local file and refuses to run if it does not parse/validate.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAuditExecute } from "../src/commands/audit.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function writeRepoRules(root: string, body: string): void {
  mkdirSync(join(root, "substrate"), { recursive: true });
  writeFileSync(join(root, "substrate", "RULES.yaml"), body, "utf8");
}

describe("corrupt registry fails closed (OP-2086)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => removeTempDir(tmp));

  it("refuses to audit when the repo-local RULES.yaml is not valid YAML", async () => {
    writeRepoRules(tmp, "rules:\n  - id: A\n    title: [unterminated\n");
    await expect(runAuditExecute({ cwd: tmp, quiet: true, noReport: true })).rejects.toThrow(
      /failed to load|broken registry/,
    );
  });

  it("refuses to audit when a rule has an invalid severity", async () => {
    writeRepoRules(tmp, ["rules:", "  - id: A", "    title: bad", "    severity: NOPE"].join("\n"));
    await expect(runAuditExecute({ cwd: tmp, quiet: true, noReport: true })).rejects.toThrow(
      /failed to load|broken registry/,
    );
  });

  it("still audits a valid registry", async () => {
    writeRepoRules(
      tmp,
      ["rules:", "  - id: OK", "    title: ok", "    severity: low", "    detector:", "      type: ripgrep", "      pattern: x"].join("\n"),
    );
    const { report } = await runAuditExecute({ cwd: tmp, quiet: true, noReport: true });
    expect(report.totalRules).toBe(1);
  });
});
