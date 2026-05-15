/**
 * Smoke test for the programmatic API exported from substrate's index.
 *
 * Exercises commands without spawning the CLI. The point is to catch
 * "we forgot to export X" or "X's signature changed in a way that
 * breaks programmatic callers."
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SUBSTRATE_VERSION,
  loadRules,
  locateRulesFile,
  runAudit,
  runAuditExecute,
  runAuditList,
  runAuditTrend,
  runInit,
  RulesLoadError,
} from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("programmatic API surface", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("SUBSTRATE_VERSION is a valid semver string", () => {
    expect(SUBSTRATE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("runInit programmatically scaffolds the repo", () => {
    runInit({ projectName: "test-project", quiet: true, stacks: ["typescript"], cwd: tmp });
    // After init, the auto dir exists with expected sub-paths
    expect(existsSync(join(tmp, "auto"))).toBe(true);
    expect(existsSync(join(tmp, "substrate.config.json"))).toBe(true);
  });

  it("runAuditList programmatically lists scaffolded audits + catalog", () => {
    runInit({ projectName: "test-project", quiet: true, stacks: ["typescript"], cwd: tmp });
    // process.chdir into the tmp so resolveTargetRoot picks it up
    const origCwd = process.cwd();
    try {
      process.chdir(tmp);
      const result = runAuditList({ quiet: true });
      expect(result.enabled.length).toBeGreaterThan(0);
      expect(result.catalog.length).toBeGreaterThan(0);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("loadRules + runAudit produces a structured report", async () => {
    // Put the rules file OUTSIDE the audited tree so the pattern doesn't
    // match the rules file itself.
    const rulesPath = join(tmp, "out", "RULES.yaml");
    writeFileSync(join(tmp, "code.txt"), "PROBE_MATCH\n", "utf8");
    // Manually create the rules dir.
    mkdirSync(join(tmp, "out"), { recursive: true });
    writeFileSync(
      rulesPath,
      [
        "rules:",
        "  - id: PROG-001",
        "    title: Programmatic API test",
        "    severity: low",
        "    detector:",
        "      type: ripgrep",
        "      pattern: PROBE_MATCH",
        "      paths: [code.txt]",
      ].join("\n"),
      "utf8",
    );

    const loaded = loadRules(rulesPath);
    expect(loaded.document.rules).toHaveLength(1);

    const report = await runAudit({
      repoRoot: tmp,
      rulesPath,
      rules: loaded.document.rules,
      scope: "programmatic-test",
    });
    expect(report.totalFindings).toBe(1);
    expect(report.rules[0]!.findings[0]!.snippet).toContain("PROBE_MATCH");
  });

  it("locateRulesFile returns null in a bare directory", () => {
    expect(locateRulesFile(tmp)).toBeNull();
  });

  it("loadRules throws RulesLoadError with a typed instance", () => {
    expect(() => loadRules(join(tmp, "missing.yaml"))).toThrow(RulesLoadError);
  });

  it("runAuditTrend on a fresh repo returns count=0", () => {
    const result = runAuditTrend({ cwd: tmp, quiet: true });
    expect(result.trend.count).toBe(0);
  });

  it("runAuditExecute throws when no RULES.yaml is configured", async () => {
    await expect(runAuditExecute({ cwd: tmp, quiet: true })).rejects.toThrow(/no RULES\.yaml/);
  });
});
