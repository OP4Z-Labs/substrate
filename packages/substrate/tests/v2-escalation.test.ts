/**
 * Tests for v2 `escalate_after` runtime (Primitive 7).
 *
 * Coverage targets:
 *   - rules.ts loader accepts escalate_after; rejects malformed entries
 *     in strict mode
 *   - computeEffectiveSeverity walks steps and picks highest-age that
 *     applies; handles `bump` semantics (low→medium→high→critical,
 *     critical caps)
 *   - buildFirstSeenIndex aggregates earliest sighting across sidecars
 *   - applyEscalations bumps severity, preserves originalSeverity,
 *     and recomputes findingsBySeverity
 *   - reference RULES.yaml ships an escalate_after example
 *   - fixture sidecars at different timestamps drive escalation
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyEscalations,
  buildFirstSeenIndex,
  computeEffectiveSeverity,
  fingerprintFinding,
  readHistoricalSidecars,
} from "../src/audit/escalation.js";
import { loadRules, RulesLoadError } from "../src/audit/rules.js";
import type {
  AuditReport,
  Finding,
  RuleDefinition,
  RuleResult,
} from "../src/audit/types.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function writeRules(cwd: string, body: string): string {
  mkdirSync(join(cwd, "substrate"), { recursive: true });
  const path = join(cwd, "substrate", "RULES.yaml");
  writeFileSync(path, body);
  return path;
}

function writeHistoricalSidecar(
  cwd: string,
  name: string,
  generatedAt: string,
  findings: Finding[],
): void {
  mkdirSync(join(cwd, "substrate", "audits"), { recursive: true });
  const payload: AuditReport = {
    schemaVersion: 1,
    substrateVersion: "test",
    generatedAt,
    repoRoot: cwd,
    rulesPath: "substrate/RULES.yaml",
    scope: "all",
    totalRules: 1,
    executedRules: 1,
    totalFindings: findings.length,
    findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    rules: [
      {
        ruleId: findings[0]?.ruleId ?? "X",
        ruleTitle: "test rule",
        severity: findings[0]?.severity ?? "low",
        detectorType: "ripgrep",
        findings,
        durationMs: 0,
        skipped: false,
      } as RuleResult,
    ],
    durationMs: 0,
  };
  writeFileSync(
    join(cwd, "substrate", "audits", name),
    JSON.stringify(payload),
  );
}

describe("rules loader — escalate_after", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("parses well-formed escalate_after into sorted steps", () => {
    const path = writeRules(
      tmp,
      `rules:
  - id: X-001
    title: test
    severity: low
    escalate_after:
      - age_days: 90
        target_severity: critical
      - age_days: 30
        target_severity: medium
`,
    );
    const result = loadRules(path);
    const rule = result.document.rules[0];
    expect(rule.escalate_after).toBeDefined();
    expect(rule.escalate_after!.map((s) => s.age_days)).toEqual([30, 90]);
  });

  it("rejects malformed escalate_after in strict mode", () => {
    const path = writeRules(
      tmp,
      `rules:
  - id: X-001
    title: t
    severity: low
    escalate_after:
      - age_days: oops
        target_severity: high
`,
    );
    expect(() => loadRules(path, { strict: true })).toThrow(RulesLoadError);
  });

  it("downgrades malformed entries to warnings when not strict", () => {
    const path = writeRules(
      tmp,
      `rules:
  - id: X-001
    title: t
    severity: low
    escalate_after:
      - age_days: -1
        target_severity: high
      - age_days: 30
        target_severity: medium
`,
    );
    const result = loadRules(path);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.document.rules[0].escalate_after).toEqual([
      { age_days: 30, target_severity: "medium" },
    ]);
  });
});

describe("computeEffectiveSeverity", () => {
  const steps = [
    { age_days: 30, target_severity: "medium" as const },
    { age_days: 90, target_severity: "high" as const },
  ];
  it("returns base when no steps apply", () => {
    expect(computeEffectiveSeverity("low", steps, 0)).toBe("low");
    expect(computeEffectiveSeverity("low", steps, 29)).toBe("low");
  });
  it("applies the first crossed step", () => {
    expect(computeEffectiveSeverity("low", steps, 30)).toBe("medium");
  });
  it("escalates further as age crosses subsequent thresholds", () => {
    expect(computeEffectiveSeverity("low", steps, 95)).toBe("high");
  });
  it("returns base when steps is undefined", () => {
    expect(computeEffectiveSeverity("low", undefined, 1000)).toBe("low");
  });
  it("handles `bump` (one level up)", () => {
    const stepsBump = [{ age_days: 30, target_severity: "bump" as const }];
    expect(computeEffectiveSeverity("low", stepsBump, 30)).toBe("medium");
    expect(computeEffectiveSeverity("medium", stepsBump, 30)).toBe("high");
    expect(computeEffectiveSeverity("high", stepsBump, 30)).toBe("critical");
    // critical caps at critical
    expect(computeEffectiveSeverity("critical", stepsBump, 30)).toBe(
      "critical",
    );
  });
});

describe("buildFirstSeenIndex + readHistoricalSidecars", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns the earliest generatedAt per fingerprint", () => {
    const finding: Finding = {
      ruleId: "X-001",
      severity: "low",
      message: "m",
      path: "apps/x.py",
      snippet: "print(",
    };
    writeHistoricalSidecar(tmp, "all-2026-01-01.json", "2026-01-01T00:00:00.000Z", [
      finding,
    ]);
    writeHistoricalSidecar(tmp, "all-2026-04-01.json", "2026-04-01T00:00:00.000Z", [
      finding,
    ]);
    const sidecars = readHistoricalSidecars(tmp);
    expect(sidecars.length).toBe(2);
    const idx = buildFirstSeenIndex(sidecars);
    expect(idx.get(fingerprintFinding(finding))).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("excludes -latest.json sidecars from history", () => {
    const finding: Finding = {
      ruleId: "X-001",
      severity: "low",
      message: "m",
      path: "apps/x.py",
      snippet: "p",
    };
    writeHistoricalSidecar(tmp, "all-2026-01-01.json", "2026-01-01T00:00:00.000Z", [finding]);
    writeHistoricalSidecar(tmp, "all-latest.json", "2026-04-01T00:00:00.000Z", [finding]);
    const sidecars = readHistoricalSidecars(tmp);
    expect(sidecars.length).toBe(1);
    expect(sidecars[0].generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("applyEscalations", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("bumps severity, preserves originalSeverity, recomputes summary", () => {
    const rule: RuleDefinition = {
      id: "X-001",
      title: "test",
      severity: "low",
      escalate_after: [
        { age_days: 30, target_severity: "medium" },
        { age_days: 90, target_severity: "high" },
      ],
    };
    const finding: Finding = {
      ruleId: "X-001",
      severity: "low",
      message: "m",
      path: "apps/x.py",
      snippet: "print(",
    };
    // Historical sidecar shows the finding first appeared 100 days ago.
    writeHistoricalSidecar(tmp, "all-2026-02-04.json", "2026-02-04T00:00:00.000Z", [
      finding,
    ]);

    const report: AuditReport = {
      schemaVersion: 1,
      substrateVersion: "t",
      generatedAt: "2026-05-15T00:00:00.000Z",
      repoRoot: tmp,
      rulesPath: "x",
      scope: "all",
      totalRules: 1,
      executedRules: 1,
      totalFindings: 1,
      findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 1 },
      rules: [
        {
          ruleId: "X-001",
          ruleTitle: "test",
          severity: "low",
          detectorType: "ripgrep",
          findings: [{ ...finding }],
          durationMs: 0,
          skipped: false,
        },
      ],
      durationMs: 0,
    };
    applyEscalations(report, {
      rules: [rule],
      repoRoot: tmp,
      now: new Date("2026-05-15T00:00:00.000Z"),
    });
    const enriched = report.rules[0].findings[0];
    expect(enriched.originalSeverity).toBe("low");
    expect(enriched.severity).toBe("high");
    expect(enriched.ageDays).toBeGreaterThanOrEqual(100);
    expect(report.findingsBySeverity).toEqual({
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
    });
  });

  it("does not change severity when no escalate_after applies", () => {
    const rule: RuleDefinition = {
      id: "X-002",
      title: "t",
      severity: "high",
    };
    const finding: Finding = {
      ruleId: "X-002",
      severity: "high",
      message: "m",
      path: "x",
    };
    const report: AuditReport = {
      schemaVersion: 1,
      substrateVersion: "t",
      generatedAt: new Date().toISOString(),
      repoRoot: tmp,
      rulesPath: "x",
      scope: "all",
      totalRules: 1,
      executedRules: 1,
      totalFindings: 1,
      findingsBySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
      rules: [
        {
          ruleId: "X-002",
          ruleTitle: "t",
          severity: "high",
          detectorType: "ripgrep",
          findings: [{ ...finding }],
          durationMs: 0,
          skipped: false,
        },
      ],
      durationMs: 0,
    };
    applyEscalations(report, { rules: [rule], repoRoot: tmp });
    expect(report.rules[0].findings[0].severity).toBe("high");
    expect(report.rules[0].findings[0].originalSeverity).toBeUndefined();
  });
});

describe("default RULES.yaml ships an escalate_after example", () => {
  // Sanity-check the bundled template — guards against accidental
  // deletion of the reference rule.
  it("BE-PY-001 has escalate_after configured", async () => {
    const { join: pjoin } = await import("node:path");
    const { getTemplatesDir } = await import("../src/util/paths.js");
    const rulesPath = pjoin(
      getTemplatesDir(),
      "standards",
      "cross-cutting",
      "RULES.yaml",
    );
    const loaded = loadRules(rulesPath);
    const rule = loaded.document.rules.find((r) => r.id === "BE-PY-001");
    expect(rule).toBeDefined();
    expect(rule!.escalate_after).toBeDefined();
    expect(rule!.escalate_after!.length).toBeGreaterThan(0);
  });
});
