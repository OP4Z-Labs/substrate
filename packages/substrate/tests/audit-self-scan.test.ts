/**
 * OP-2085 — the audit must not scan its own RULES.yaml.
 *
 * A rule's `pattern:` string lives in the registry. A whole-repo rule with
 * `match_count: 0` semantics (any match is a violation) would otherwise match
 * its own definition and flag the registry file — every rule fires on itself.
 * The runner excludes the loaded registry from every detector's scan.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRules, runAudit } from "../src/audit/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("registry self-scan exclusion (OP-2085)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    mkdirSync(join(tmp, "substrate"), { recursive: true });
  });
  afterEach(() => removeTempDir(tmp));

  it("does not flag a rule's own pattern inside the registry file", async () => {
    const rulesPath = join(tmp, "substrate", "RULES.yaml");
    // The pattern `FORBIDDEN_TOKEN` appears in this very file (as the pattern
    // value). Without the exclusion, the whole-repo scan would match it here.
    writeFileSync(
      rulesPath,
      ["rules:", "  - id: NO-TOKEN", "    title: no forbidden token", "    severity: high", "    detector:", "      type: ripgrep", "      pattern: FORBIDDEN_TOKEN"].join("\n"),
      "utf8",
    );
    // A real occurrence in a source file — this one SHOULD be found.
    writeFileSync(join(tmp, "app.ts"), "const x = FORBIDDEN_TOKEN;\n", "utf8");

    const { document } = loadRules(rulesPath);
    const report = await runAudit({ repoRoot: tmp, rulesPath, rules: document.rules, scope: "all" });

    const paths = report.rules.flatMap((r) => r.findings.map((f) => f.path));
    expect(paths).toContain("app.ts"); // the real hit is found
    expect(paths.some((p) => p && p.includes("RULES.yaml"))).toBe(false); // the registry is not self-flagged
  });

  it("still scans a valid source file when the registry sits under substrate/", async () => {
    const rulesPath = join(tmp, "substrate", "RULES.yaml");
    writeFileSync(
      rulesPath,
      ["rules:", "  - id: R", "    title: r", "    severity: low", "    detector: { type: ripgrep, pattern: NEEDLE }"].join("\n"),
      "utf8",
    );
    writeFileSync(join(tmp, "src.txt"), "NEEDLE\n", "utf8");
    const { document } = loadRules(rulesPath);
    const report = await runAudit({ repoRoot: tmp, rulesPath, rules: document.rules, scope: "all" });
    expect(report.totalFindings).toBe(1);
    expect(report.rules[0]!.findings[0]!.path).toBe("src.txt");
  });
});
