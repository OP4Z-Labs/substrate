/**
 * Fixes for the three defects the adversarial beta.5 smoke pass found.
 *
 * 1. --strict now makes an unknown field fatal on the discovery path, not only
 *    via --rules-path (the help string promised it everywhere).
 * 2. A composite that resolves NONE of its referenced rules is a detector
 *    error (errors[]), not a silently-fired clean rule.
 * 3. --rules-path + a corrupt file in --json mode emits the rules-load-failed
 *    envelope instead of empty stdout.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRules, runAudit } from "../src/audit/index.js";
import { JsonAlreadyEmittedError, runAuditExecute } from "../src/commands/audit.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function writeDiscoveryRules(root: string, body: string): void {
  mkdirSync(join(root, "substrate"), { recursive: true });
  writeFileSync(join(root, "substrate", "RULES.yaml"), body, "utf8");
}

describe("smoke-fix 1: --strict is fatal on the discovery path", () => {
  let tmp: string;
  let saved: typeof process.exitCode;
  beforeEach(() => {
    tmp = makeTempDir();
    saved = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    removeTempDir(tmp);
    process.exitCode = saved;
  });

  const UNKNOWN_FIELD = [
    "rules:",
    "  - id: A",
    "    title: has an unknown top-level field",
    "    severity: high",
    "    servrity: high", // typo — unknown field, valid severity present
    "    detector: { type: ripgrep, pattern: x }",
  ].join("\n");

  it("fails closed under --strict when the repo-local registry has an unknown field", async () => {
    writeDiscoveryRules(tmp, UNKNOWN_FIELD);
    await expect(
      runAuditExecute({ cwd: tmp, strict: true, quiet: true, noReport: true }),
    ).rejects.toThrow(/unknown field|failed to load|servrity/);
  });

  it("still audits (exit 0) without --strict — unknown field is a warning", async () => {
    writeDiscoveryRules(tmp, UNKNOWN_FIELD);
    const { report } = await runAuditExecute({ cwd: tmp, quiet: true, noReport: true });
    expect(report.totalRules).toBe(1);
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe("smoke-fix 2: a composite that resolves no refs is an error", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => removeTempDir(tmp));

  it("lands in errors[] and is not counted as fired", async () => {
    const p = join(tmp, "RULES.yaml");
    writeFileSync(
      p,
      [
        "rules:",
        "  - id: COMP",
        "    title: composite over missing rules",
        "    severity: high",
        "    detector:",
        "      type: composite",
        "      operator: any",
        "      rules: [NOPE-1, NOPE-2]",
      ].join("\n"),
      "utf8",
    );
    const { document } = loadRules(p);
    const report = await runAudit({ repoRoot: tmp, rulesPath: p, rules: document.rules, scope: "all" });
    expect(report.errors.map((e) => e.ruleId)).toContain("COMP");
    expect(report.firedRules).toBe(0);
    const comp = report.rules.find((r) => r.ruleId === "COMP")!;
    expect(comp.error).toBeTruthy();
  });

  it("a composite with at least one resolvable ref still evaluates", async () => {
    writeFileSync(join(tmp, "src.txt"), "NEEDLE\n", "utf8");
    const p = join(tmp, "RULES.yaml");
    writeFileSync(
      p,
      [
        "rules:",
        "  - id: SUB",
        "    title: sub",
        "    severity: low",
        "    detector: { type: ripgrep, pattern: NEEDLE }",
        "  - id: COMP",
        "    title: composite over a present + a missing rule",
        "    severity: high",
        "    detector: { type: composite, operator: any, rules: [SUB, NOPE] }",
      ].join("\n"),
      "utf8",
    );
    const { document } = loadRules(p);
    const report = await runAudit({ repoRoot: tmp, rulesPath: p, rules: document.rules, scope: "all" });
    expect(report.errors.map((e) => e.ruleId)).not.toContain("COMP");
  });
});

describe("smoke-fix 3: --rules-path corrupt file emits a JSON envelope", () => {
  let tmp: string;
  let saved: typeof process.exitCode;
  beforeEach(() => {
    tmp = makeTempDir();
    saved = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    removeTempDir(tmp);
    process.exitCode = saved;
  });

  it("throws JsonAlreadyEmittedError (envelope on stdout) under --json", async () => {
    const p = join(tmp, "bad.yaml");
    writeFileSync(p, "rules:\n  - id: A\n    title: t\n    severity: NOPE\n", "utf8");
    let caught: unknown;
    try {
      await runAuditExecute({ cwd: tmp, rulesPath: p, json: true, quiet: true, noReport: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(JsonAlreadyEmittedError);
    expect(process.exitCode).toBe(1);
  });
});
