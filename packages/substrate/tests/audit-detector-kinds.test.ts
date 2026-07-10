/**
 * Loader honesty for non-executable and annotated detectors (U12, U5, U4).
 *
 * - U12: `shell`, explicit `manual`, and no-detector rules used to render
 *   identically as `manual` — a silently-inert `shell` rule and a deliberate
 *   review item were indistinguishable. They now carry distinct detectorType /
 *   note.
 * - U5:  a `shell` type (which this runtime cannot execute) warns every load,
 *   not only under --strict.
 * - U4:  an unknown key inside `detector` warns (or fails under --strict);
 *   `metadata` and `expected` are sanctioned so the 131 rules that legitimately
 *   carry `expected` do not flood the warning channel.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRules, runAudit } from "../src/audit/index.js";
import { RulesLoadError } from "../src/audit/rules.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function write(dir: string, body: string): string {
  const p = join(dir, "RULES.yaml");
  writeFileSync(p, body, "utf8");
  return p;
}

describe("loader: manual kinds and warnings", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => removeTempDir(tmp));

  it("distinguishes shell / explicit-manual / no-detector in the report (U12)", async () => {
    const p = write(
      tmp,
      [
        "rules:",
        "  - id: SHELL-1",
        "    title: a shell rule",
        "    severity: high",
        "    detector: { type: shell, command: 'mypy .' }",
        "  - id: MANUAL-1",
        "    title: an explicit manual rule",
        "    severity: medium",
        "    detector: { type: manual }",
        "  - id: NONE-1",
        "    title: a rule with no detector",
        "    severity: low",
      ].join("\n"),
    );
    const { document } = loadRules(p);
    const report = await runAudit({ repoRoot: tmp, rulesPath: p, rules: document.rules, scope: "all" });
    const byId = Object.fromEntries(report.rules.map((r) => [r.ruleId, r]));

    expect(byId["SHELL-1"]!.detectorType).toBe("shell");
    expect(byId["SHELL-1"]!.note).toMatch(/not executable/);
    expect(byId["MANUAL-1"]!.detectorType).toBe("manual");
    expect(byId["MANUAL-1"]!.note).toMatch(/declared type: manual/);
    expect(byId["NONE-1"]!.detectorType).toBe("manual");
    expect(byId["NONE-1"]!.note).toMatch(/no detector configured/);

    // None of these are detector ERRORS — they are inert-by-declaration.
    expect(report.errors).toEqual([]);
  });

  it("warns on a shell type on every load, not only under --strict (U5)", () => {
    const p = write(
      tmp,
      ["rules:", "  - id: S", "    title: s", "    severity: high", "    detector: { type: shell, command: 'x' }"].join("\n"),
    );
    const loaded = loadRules(p); // non-strict
    expect(loaded.warnings.some((w) => w.includes("shell"))).toBe(true);
  });

  it("warns on an unknown detector key but sanctions expected (U4)", () => {
    const p = write(
      tmp,
      [
        "rules:",
        "  - id: TYPO",
        "    title: has a typo'd detector key and a sanctioned one",
        "    severity: high",
        "    metadata: { review: 'see docs' }", // rule-level -> no detector warn
        "    detector:",
        "      type: ripgrep",
        "      pattern: x",
        "      patern: oops", // typo -> warn
        "      expected: { match_count: 0 }", // sanctioned inert key -> no warn
      ].join("\n"),
    );
    const loaded = loadRules(p);
    const unknown = loaded.warnings.filter((w) => w.includes("unknown key"));
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toContain("patern");
  });

  it("fails on an unknown detector key under --strict (U4)", () => {
    const p = write(
      tmp,
      ["rules:", "  - id: TYPO", "    title: t", "    severity: high", "    detector: { type: ripgrep, pattern: x, patern: oops }"].join("\n"),
    );
    expect(() => loadRules(p, { strict: true })).toThrow(RulesLoadError);
  });

  it("warns on rule-level metadata.polarity: presence with a non-script detector (D7)", () => {
    const p = write(
      tmp,
      [
        "rules:",
        "  - id: P",
        "    title: presence on ripgrep is inert",
        "    severity: critical",
        "    metadata: { polarity: presence }",
        "    detector:",
        "      type: ripgrep",
        "      pattern: x",
      ].join("\n"),
    );
    const loaded = loadRules(p);
    expect(loaded.warnings.some((w) => w.includes("metadata.polarity") && w.includes("inert"))).toBe(true);
  });
});
