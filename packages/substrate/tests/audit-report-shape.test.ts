/**
 * Report-shape contract: `firedRules`, `errors[]`, and `rulesetHash`.
 *
 * These fields make the report answer three questions a raw finding count
 * cannot: how much of the registry actually ran, which rules could not run,
 * and whether the ruleset changed between two runs. Before them, a detector
 * that threw was laundered into `skipped: true, findings: []` — indistinguishable
 * from a rule that ran clean.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashRuleset, loadRules, runAudit } from "../src/audit/index.js";
import type { RuleDefinition } from "../src/audit/types.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

/** A registry with one firing rule, one manual rule, and one that must error. */
function writeMixedRules(dir: string): string {
  const p = join(dir, "RULES.yaml");
  writeFileSync(
    p,
    [
      "rules:",
      "  - id: FIRES-001",
      "    title: A rule that fires",
      "    severity: high",
      "    detector:",
      "      type: ripgrep",
      "      pattern: NEEDLE",
      "  - id: MANUAL-001",
      "    title: A manual rule",
      "    severity: low",
      // no detector -> manual/skipped
      "  - id: ERRORS-001",
      "    title: A rule whose pattern cannot compile",
      "    severity: critical",
      "    detector:",
      "      type: ripgrep",
      "      pattern: '['", // unterminated char class: rg exits 2, RegExp() throws
    ].join("\n"),
    "utf8",
  );
  return p;
}

describe("audit report shape: firedRules / errors[] / rulesetHash", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    writeFileSync(join(tmp, "src.txt"), "NEEDLE here\n", "utf8");
  });
  afterEach(() => removeTempDir(tmp));

  it("counts only rules that ran a detector to completion as fired", async () => {
    const rulesPath = writeMixedRules(tmp);
    const { document } = loadRules(rulesPath);
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath,
      rules: document.rules,
      scope: "all",
    });
    // FIRES-001 fired; MANUAL-001 is skipped; ERRORS-001 errored.
    expect(report.totalRules).toBe(3);
    expect(report.firedRules).toBe(1);
  });

  it("hoists a detector that threw into errors[], not a clean skip", async () => {
    const rulesPath = writeMixedRules(tmp);
    const { document } = loadRules(rulesPath);
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath,
      rules: document.rules,
      scope: "all",
    });
    expect(report.errors).toHaveLength(1);
    const err = report.errors[0]!;
    expect(err.ruleId).toBe("ERRORS-001");
    expect(err.severity).toBe("critical");
    expect(err.message.length).toBeGreaterThan(0);

    // The errored rule must NOT read as a clean, zero-finding rule.
    const errored = report.rules.find((r) => r.ruleId === "ERRORS-001")!;
    expect(errored.error).toBeTruthy();
    expect(errored.findings).toEqual([]);
  });

  it("emits an empty errors[] when every rule runs clean", async () => {
    const p = join(tmp, "clean.yaml");
    writeFileSync(
      p,
      ["rules:", "  - id: OK-1", "    title: ok", "    severity: low", "    detector:", "      type: ripgrep", "      pattern: NEEDLE"].join("\n"),
      "utf8",
    );
    const { document } = loadRules(p);
    const report = await runAudit({ repoRoot: tmp, rulesPath: p, rules: document.rules, scope: "all" });
    expect(report.errors).toEqual([]);
    expect(report.firedRules).toBe(1);
  });
});

describe("hashRuleset", () => {
  const base: RuleDefinition[] = [
    { id: "B", title: "b", severity: "low", detector: { type: "ripgrep", pattern: "x" } },
    { id: "A", title: "a", severity: "high", detector: { type: "ripgrep", pattern: "y" } },
  ];

  it("is stable regardless of rule array order", () => {
    const reversed = [...base].reverse();
    expect(hashRuleset(base)).toBe(hashRuleset(reversed));
  });

  it("changes when a detector pattern changes", () => {
    const before = hashRuleset(base);
    const mutated = base.map((r) =>
      r.id === "A" ? { ...r, detector: { type: "ripgrep" as const, pattern: "CHANGED" } } : r,
    );
    expect(hashRuleset(mutated)).not.toBe(before);
  });

  it("changes when a rule's severity changes", () => {
    const before = hashRuleset(base);
    const mutated = base.map((r) => (r.id === "A" ? { ...r, severity: "critical" as const } : r));
    expect(hashRuleset(mutated)).not.toBe(before);
  });

  it("is a short hex string", () => {
    expect(hashRuleset(base)).toMatch(/^[0-9a-f]{12}$/);
  });
});
