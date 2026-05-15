/**
 * Unit tests for the detector runtime.
 *
 * Exercises loader / ripgrep detector (both fast + fallback paths) /
 * script detector / composite detector / report writer / trend reader.
 *
 * Live in `tests/` rather than `tests/integration/` because they all
 * drive the programmatic API directly without spawning the CLI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadRules,
  locateRulesFile,
  RulesLoadError,
  runAudit,
  writeAuditReport,
  readTrend,
} from "../src/audit/index.js";
import { resetRipgrepProbe, runRipgrepDetector } from "../src/audit/detectors/ripgrep.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("audit-runtime: rules loader", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("parses a valid RULES.yaml and returns the rule definitions", () => {
    const rulesPath = join(tmp, "RULES.yaml");
    writeFileSync(
      rulesPath,
      [
        "meta:",
        "  version: 1.0.0",
        "rules:",
        "  - id: TEST-001",
        "    title: A test rule",
        "    severity: high",
        "    detector:",
        "      type: ripgrep",
        "      pattern: foo",
      ].join("\n"),
      "utf8",
    );
    const loaded = loadRules(rulesPath);
    expect(loaded.document.rules).toHaveLength(1);
    expect(loaded.document.rules[0]!.id).toBe("TEST-001");
    expect(loaded.document.rules[0]!.detector).toEqual({
      type: "ripgrep",
      pattern: "foo",
      paths: undefined,
      exclude: undefined,
      caseSensitive: undefined,
      fixedString: undefined,
      multiline: undefined,
    });
    expect(loaded.warnings).toEqual([]);
  });

  it("throws RulesLoadError on a missing file", () => {
    expect(() => loadRules(join(tmp, "no-such.yaml"))).toThrow(RulesLoadError);
  });

  it("throws RulesLoadError on a missing rules array", () => {
    const p = join(tmp, "bad.yaml");
    writeFileSync(p, "meta:\n  version: 1\n", "utf8");
    expect(() => loadRules(p)).toThrow(/missing the "rules:" array/);
  });

  it("rejects an invalid severity", () => {
    const p = join(tmp, "bad-sev.yaml");
    writeFileSync(
      p,
      "rules:\n  - id: A\n    title: B\n    severity: BOGUS\n",
      "utf8",
    );
    expect(() => loadRules(p)).toThrow(/invalid severity/);
  });

  it("rejects duplicate rule ids", () => {
    const p = join(tmp, "dup.yaml");
    writeFileSync(
      p,
      [
        "rules:",
        "  - id: SAME",
        "    title: One",
        "    severity: low",
        "  - id: SAME",
        "    title: Two",
        "    severity: low",
      ].join("\n"),
      "utf8",
    );
    expect(() => loadRules(p)).toThrow(/Duplicate rule id "SAME"/);
  });

  it("collects warnings for legacy 'shell' detector when not strict", () => {
    const p = join(tmp, "legacy.yaml");
    writeFileSync(
      p,
      [
        "rules:",
        "  - id: LEG-001",
        "    title: Legacy",
        "    severity: medium",
        "    detector:",
        "      type: shell",
        "      command: 'echo hi'",
      ].join("\n"),
      "utf8",
    );
    // Strict mode emits a warning AND keeps the rule (no detector).
    const loaded = loadRules(p, { strict: true });
    expect(loaded.warnings.length).toBeGreaterThan(0);
    expect(loaded.document.rules[0]!.detector).toBeUndefined();
  });

  it("rejects composite rules with an invalid operator", () => {
    const p = join(tmp, "bad-comp.yaml");
    writeFileSync(
      p,
      [
        "rules:",
        "  - id: COMP-001",
        "    title: Bad composite",
        "    severity: high",
        "    detector:",
        "      type: composite",
        "      operator: bogus",
        "      rules: [TEST-001]",
      ].join("\n"),
      "utf8",
    );
    expect(() => loadRules(p)).toThrow(/invalid operator/);
  });

  it("locateRulesFile prefers substrate/RULES.yaml over auto/RULES.yaml", () => {
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    mkdirSync(join(tmp, "auto"), { recursive: true });
    const substratePath = join(tmp, "substrate", "RULES.yaml");
    const autoPath = join(tmp, "auto", "RULES.yaml");
    writeFileSync(substratePath, "rules: []\n", "utf8");
    writeFileSync(autoPath, "rules: []\n", "utf8");
    expect(locateRulesFile(tmp)).toBe(substratePath);
  });

  it("locateRulesFile returns null when neither location has a file", () => {
    expect(locateRulesFile(tmp)).toBeNull();
  });

  it("locateRulesFile honors an explicit path override", () => {
    const custom = join(tmp, "custom-rules.yaml");
    writeFileSync(custom, "rules: []\n", "utf8");
    expect(locateRulesFile(tmp, "custom-rules.yaml")).toBe(custom);
  });
});

describe("audit-runtime: ripgrep detector (Node fallback path)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    resetRipgrepProbe();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("finds matches in a single file and returns sorted findings", () => {
    writeFileSync(join(tmp, "a.txt"), "first match\nsecond no\nthird match\n", "utf8");
    const findings = runRipgrepDetector(
      { type: "ripgrep", pattern: "match" },
      { repoRoot: tmp, ruleId: "T-1", severity: "high", forceFallback: true },
    );
    expect(findings.map((f) => f.line)).toEqual([1, 3]);
    expect(findings[0]!.path).toBe("a.txt");
    expect(findings[0]!.snippet).toContain("first match");
  });

  it("respects exclude globs", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    mkdirSync(join(tmp, "node_modules"), { recursive: true });
    writeFileSync(join(tmp, "src", "found.ts"), "TARGET\n", "utf8");
    writeFileSync(join(tmp, "node_modules", "skip.js"), "TARGET\n", "utf8");
    const findings = runRipgrepDetector(
      { type: "ripgrep", pattern: "TARGET" },
      { repoRoot: tmp, ruleId: "T-2", severity: "medium", forceFallback: true },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe(join("src", "found.ts"));
  });

  it("honors caseSensitive=false", () => {
    writeFileSync(join(tmp, "a.txt"), "FoO\nbar\n", "utf8");
    const findings = runRipgrepDetector(
      { type: "ripgrep", pattern: "foo", caseSensitive: false },
      { repoRoot: tmp, ruleId: "T-3", severity: "low", forceFallback: true },
    );
    expect(findings).toHaveLength(1);
  });

  it("treats fixedString patterns as literals (regex chars don't apply)", () => {
    writeFileSync(join(tmp, "a.txt"), "fn(\nfn (\n", "utf8");
    const findings = runRipgrepDetector(
      { type: "ripgrep", pattern: "fn(", fixedString: true },
      { repoRoot: tmp, ruleId: "T-4", severity: "medium", forceFallback: true },
    );
    // Only the literal "fn(" matches — "fn (" has a space.
    expect(findings.map((f) => f.line)).toEqual([1]);
  });

  it("skips binary files", () => {
    writeFileSync(join(tmp, "img.png"), "ignore\nTARGET\n", "utf8");
    writeFileSync(join(tmp, "code.ts"), "TARGET\n", "utf8");
    const findings = runRipgrepDetector(
      { type: "ripgrep", pattern: "TARGET" },
      { repoRoot: tmp, ruleId: "T-5", severity: "medium", forceFallback: true },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe("code.ts");
  });
});

describe("audit-runtime: runner — composite + ripgrep", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    resetRipgrepProbe();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("runs every rule and returns a structured report", async () => {
    writeFileSync(join(tmp, "src.txt"), "BAD_PATTERN here\n", "utf8");
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [
        {
          id: "X-1",
          title: "Hits",
          severity: "high",
          detector: { type: "ripgrep", pattern: "BAD_PATTERN" },
        },
        {
          id: "X-2",
          title: "Misses",
          severity: "low",
          detector: { type: "ripgrep", pattern: "NEVER_SEEN" },
        },
        {
          id: "X-3",
          title: "Manual only",
          severity: "medium",
        },
      ],
      scope: "test",
    });
    expect(report.totalFindings).toBe(1);
    expect(report.findingsBySeverity.high).toBe(1);
    expect(report.executedRules).toBe(3);
    const x3 = report.rules.find((r) => r.ruleId === "X-3");
    expect(x3?.skipped).toBe(true);
  });

  it("evaluates a composite-any after its sub-rules", async () => {
    writeFileSync(join(tmp, "trigger.txt"), "FIRE\n", "utf8");
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [
        {
          id: "SUB-1",
          title: "Sub one",
          severity: "high",
          detector: { type: "ripgrep", pattern: "FIRE" },
        },
        {
          id: "SUB-2",
          title: "Sub two",
          severity: "high",
          detector: { type: "ripgrep", pattern: "NOPE" },
        },
        {
          id: "COMP-ANY",
          title: "Any of sub",
          severity: "medium",
          detector: { type: "composite", operator: "any", rules: ["SUB-1", "SUB-2"] },
        },
      ],
      scope: "composite-any",
    });
    const comp = report.rules.find((r) => r.ruleId === "COMP-ANY");
    expect(comp?.findings).toHaveLength(1);
  });

  it("does not trigger composite-all when only one sub-rule fires", async () => {
    writeFileSync(join(tmp, "one.txt"), "FIRE\n", "utf8");
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [
        {
          id: "S1",
          title: "S1",
          severity: "high",
          detector: { type: "ripgrep", pattern: "FIRE" },
        },
        {
          id: "S2",
          title: "S2",
          severity: "high",
          detector: { type: "ripgrep", pattern: "ABSENT" },
        },
        {
          id: "C",
          title: "All",
          severity: "medium",
          detector: { type: "composite", operator: "all", rules: ["S1", "S2"] },
        },
      ],
      scope: "composite-all",
    });
    expect(report.rules.find((r) => r.ruleId === "C")?.findings).toHaveLength(0);
  });

  it("composite-none triggers when no sub-rule fires", async () => {
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [
        {
          id: "S1",
          title: "S1",
          severity: "high",
          detector: { type: "ripgrep", pattern: "NEVER" },
        },
        {
          id: "C",
          title: "None",
          severity: "medium",
          detector: { type: "composite", operator: "none", rules: ["S1"] },
        },
      ],
      scope: "composite-none",
    });
    expect(report.rules.find((r) => r.ruleId === "C")?.findings).toHaveLength(1);
  });
});

describe("audit-runtime: report writer", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("writes a Markdown report + JSON sidecar + trend journal", async () => {
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [{ id: "EMPTY-1", title: "no findings", severity: "low" }],
      scope: "all",
    });
    // Use a date constructed in local time so isoDate() picks the same calendar day.
    const reportDate = new Date(2026, 4, 14); // year, month-0idx, day
    const paths = writeAuditReport(report, { repoRoot: tmp, scope: "all", date: reportDate });
    expect(existsSync(paths.markdownPath)).toBe(true);
    expect(paths.markdownPath.endsWith("all-2026-05-14.md")).toBe(true);
    expect(existsSync(paths.jsonPath)).toBe(true);
    expect(existsSync(paths.trendPath)).toBe(true);
    const md = readFileSync(paths.markdownPath, "utf8");
    expect(md).toContain("Substrate Audit Report — all");
    const json = JSON.parse(readFileSync(paths.jsonPath, "utf8"));
    expect(json.schemaVersion).toBe(1);
    const trend = readFileSync(paths.trendPath, "utf8").trim().split("\n");
    expect(trend).toHaveLength(1);
    expect(JSON.parse(trend[0]!).scope).toBe("all");
  });

  it("readTrend groups entries by scope and counts them", async () => {
    const r1 = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [{ id: "X", title: "x", severity: "low" }],
      scope: "scope-a",
    });
    const r2 = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [{ id: "Y", title: "y", severity: "low" }],
      scope: "scope-b",
    });
    writeAuditReport(r1, { repoRoot: tmp, scope: "scope-a" });
    writeAuditReport(r2, { repoRoot: tmp, scope: "scope-b" });
    const trend = readTrend(tmp);
    expect(trend.count).toBe(2);
    expect(Object.keys(trend.byScope).sort()).toEqual(["scope-a", "scope-b"]);
  });
});
