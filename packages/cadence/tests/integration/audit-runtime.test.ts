/**
 * Integration tests for `cadence audit` (v1.0 detector runtime).
 *
 * Spawn the built CLI against a fresh tmp dir with a hand-rolled
 * `cadence/RULES.yaml`. Asserts exit code, output shape, and the report
 * artefacts on disk.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

describe("integration: cadence audit (detector runtime)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpDir();
  });
  afterEach(() => {
    removeTmpDir(tmp);
  });

  function writeRules(yaml: string): void {
    mkdirSync(join(tmp, "cadence"), { recursive: true });
    writeFileSync(join(tmp, "cadence", "RULES.yaml"), yaml, "utf8");
  }

  it("returns an error and exit code 1 when no RULES.yaml is present", () => {
    const result = runCli(["audit"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("no RULES.yaml found");
  });

  it("runs all rules and emits a Markdown + JSON report", () => {
    writeFileSync(join(tmp, "src.ts"), "const TODO_BAD = 1;\n", "utf8");
    writeRules(
      [
        "rules:",
        "  - id: NO-TODO",
        "    title: No TODO_BAD",
        "    severity: medium",
        "    detector:",
        "      type: ripgrep",
        "      pattern: TODO_BAD",
      ].join("\n"),
    );
    const result = runCli(["audit"], { cwd: tmp });
    expect(result.status).toBe(0);
    expect(result.output).toContain("NO-TODO");
    // Report files should land under cadence/audits/.
    const auditsDir = join(tmp, "cadence", "audits");
    expect(existsSync(auditsDir)).toBe(true);
    const jsonSidecar = join(auditsDir, "all-latest.json");
    expect(existsSync(jsonSidecar)).toBe(true);
    const trend = join(auditsDir, "_trend.jsonl");
    expect(existsSync(trend)).toBe(true);
  });

  it("respects --rule <id> by running just one rule", () => {
    writeFileSync(join(tmp, "src.ts"), "ALPHA\nBETA\n", "utf8");
    writeRules(
      [
        "rules:",
        "  - id: R-A",
        "    title: A",
        "    severity: low",
        "    detector: { type: ripgrep, pattern: ALPHA }",
        "  - id: R-B",
        "    title: B",
        "    severity: low",
        "    detector: { type: ripgrep, pattern: BETA }",
      ].join("\n"),
    );
    const result = runCli(["audit", "--rule", "R-A", "--json", "--no-report"], { cwd: tmp });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.report.executedRules).toBe(1);
    expect(parsed.report.rules[0].ruleId).toBe("R-A");
  });

  it("--trend reads the journal back", () => {
    writeFileSync(join(tmp, "src.ts"), "alpha\n", "utf8");
    writeRules(
      [
        "rules:",
        "  - id: T-1",
        "    title: T1",
        "    severity: low",
        "    detector: { type: ripgrep, pattern: alpha }",
      ].join("\n"),
    );
    // Two runs to populate the journal.
    runCli(["audit"], { cwd: tmp });
    runCli(["audit"], { cwd: tmp });
    const result = runCli(["audit", "--trend", "--json"], { cwd: tmp });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.count).toBe(2);
    expect(parsed.byScope.all.length).toBe(2);
  });

  it("rejects unknown rule IDs with an actionable message", () => {
    writeRules("rules:\n  - id: ONLY\n    title: O\n    severity: low\n");
    const result = runCli(["audit", "--rule", "DOES-NOT-EXIST"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/not found/i);
    expect(result.output).toContain("ONLY");
  });

  it("--rules-path lets the user point at an alternate file", () => {
    const alt = join(tmp, "alt-rules.yaml");
    writeFileSync(
      alt,
      [
        "rules:",
        "  - id: ALT-1",
        "    title: alt",
        "    severity: low",
        "    detector: { type: ripgrep, pattern: ALPHA }",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(tmp, "src.ts"), "ALPHA\n", "utf8");
    const result = runCli(["audit", "--rules-path", "alt-rules.yaml", "--json", "--no-report"], { cwd: tmp });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.report.rules[0].ruleId).toBe("ALT-1");
  });

  it("--json outputs the full report envelope on stdout", () => {
    writeRules("rules:\n  - id: J-1\n    title: t\n    severity: low\n");
    const result = runCli(["audit", "--json", "--no-report"], { cwd: tmp });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.report.schemaVersion).toBe(1);
    expect(parsed.report.scope).toBe("all");
    // Sidecar should not have been written.
    const json = readFileSync.toString;
    expect(json).toBeTruthy();
    expect(existsSync(join(tmp, "cadence", "audits"))).toBe(false);
  });
});
