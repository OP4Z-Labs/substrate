/**
 * Tests for the v2 doctor enhancement checks (Phase B4, Primitive 10):
 *
 *   - rules-doc-coverage
 *   - workflow-coverage
 *   - stale-proposals
 *   - escalation-debt
 *   - --check filtering (run only the named v2 check; baseline suppressed)
 *
 * memory-frontmatter has its own test file (v2-doctor-memory.test.ts);
 * we don't re-test it here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/commands/doctor.js";
import { runInit } from "../src/commands/init.js";

let tmpRoot: string;
let previousCwd: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-doctor-v2-"));
  previousCwd = process.cwd();
  process.chdir(tmpRoot);
  runInit({ projectName: "doc-v2", shortCode: "DV", quiet: true });
  // These tests want to probe doctor with their own narrow fixtures.
  // `runInit` (since the v2-layout scaffold fix) seeds `substrate/workflows/`
  // with reference manifests; clear that dir so each test starts from a
  // known-empty workflows + RULES baseline. Tests that need workflows write
  // them via `writeWorkflowManifest`; tests that need RULES write it via
  // `writeRulesYaml`.
  rmSync(join(tmpRoot, "substrate", "workflows"), {
    recursive: true,
    force: true,
  });
  rmSync(join(tmpRoot, "substrate", "RULES.yaml"), { force: true });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  process.chdir(previousCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  process.exitCode = 0;
});

function writeRulesYaml(content: string): void {
  const dir = join(tmpRoot, "substrate");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "RULES.yaml"), content, "utf8");
}

function writeWorkflowManifest(id: string, body: boolean): void {
  const dir = join(tmpRoot, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.yaml`),
    `id: ${id}\nname: ${id}\nschema_version: v2.0\nkind: other\n`,
    "utf8",
  );
  if (body) {
    writeFileSync(join(dir, `${id}.body.md`), `# ${id}\n`, "utf8");
  }
}

function writePending(filename: string, body = "## Proposal\n\n"): void {
  const dir = join(tmpRoot, "substrate", "proposals", "pending");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), body, "utf8");
}

describe("substrate doctor — rules-doc-coverage", () => {
  it("severity=ok when no RULES.yaml is present (nothing to score)", () => {
    const report = runDoctor({ only: ["rules-doc-coverage"] });
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.id).toBe("rules.doc-coverage");
    expect(report.checks[0]?.severity).toBe("ok");
  });

  it("severity=ok when every rule has a doc reference", () => {
    writeRulesYaml(`
rules:
  - id: BE-PY-001
    title: Use type hints
    severity: medium
    doc: substrate/standards/backend/python.md#type-hints
  - id: BE-PY-002
    title: No bare except
    severity: high
    doc: substrate/standards/backend/python.md#exceptions
`);
    const report = runDoctor({ only: ["rules-doc-coverage"] });
    expect(report.checks).toHaveLength(1);
    const check = report.checks[0]!;
    expect(check.severity).toBe("ok");
    expect(check.message).toContain("2 rules");
  });

  it("severity=warn lists undocumented rule ids when doc fields are missing", () => {
    writeRulesYaml(`
rules:
  - id: BE-PY-001
    title: Use type hints
    severity: medium
    doc: substrate/standards/backend/python.md#type-hints
  - id: BE-PY-002
    title: No bare except
    severity: high
  - id: FE-REACT-001
    title: No bare buttons
    severity: medium
    doc: ""
`);
    const report = runDoctor({ only: ["rules-doc-coverage"] });
    expect(report.checks).toHaveLength(1);
    const check = report.checks[0]!;
    expect(check.severity).toBe("warn");
    expect(check.message).toContain("2 of 3");
    expect(check.message).toContain("BE-PY-002");
    expect(check.message).toContain("FE-REACT-001");
  });
});

describe("substrate doctor — workflow-coverage", () => {
  it("severity=ok when no workflows exist (pre-v2 install or empty)", () => {
    const report = runDoctor({ only: ["workflow-coverage"] });
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.severity).toBe("ok");
    expect(report.checks[0]?.message).toMatch(/no workflows discovered/);
  });

  it("severity=ok when every workflow has a paired .body.md", () => {
    writeWorkflowManifest("alpha", true);
    writeWorkflowManifest("beta", true);
    const report = runDoctor({ only: ["workflow-coverage"] });
    const coverage = report.checks.find((c) => c.id === "workflow.coverage");
    expect(coverage?.severity).toBe("ok");
    expect(coverage?.message).toContain("2 workflows");
  });

  it("severity=warn when one workflow lacks a body", () => {
    writeWorkflowManifest("alpha", true);
    writeWorkflowManifest("beta", false);
    const report = runDoctor({ only: ["workflow-coverage"] });
    const coverage = report.checks.find((c) => c.id === "workflow.coverage");
    expect(coverage?.severity).toBe("warn");
    expect(coverage?.message).toContain("beta");
  });

  it("severity=error when a manifest fails validation", () => {
    // Missing required `id` field → invalid manifest.
    const dir = join(tmpRoot, "substrate", "workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.yaml"), "name: broken\n", "utf8");
    const report = runDoctor({ only: ["workflow-coverage"] });
    const invalid = report.checks.find((c) => c.id === "workflow.coverage.invalid");
    expect(invalid).toBeTruthy();
    expect(invalid?.severity).toBe("error");
  });
});

describe("substrate doctor — stale-proposals", () => {
  it("severity=ok when no pending proposals exist", () => {
    const report = runDoctor({ only: ["stale-proposals"] });
    const c = report.checks.find((c) => c.id === "proposals.stale");
    expect(c?.severity).toBe("ok");
    expect(c?.message).toMatch(/no pending proposals/);
  });

  it("severity=ok when all pending proposals are recent", () => {
    const today = new Date().toISOString().slice(0, 10);
    writePending(`${today}-tackle-task-abcd1234.md`);
    const report = runDoctor({ only: ["stale-proposals"] });
    const c = report.checks.find((c) => c.id === "proposals.stale");
    expect(c?.severity).toBe("ok");
    expect(c?.message).toContain("1 pending");
  });

  it("severity=warn when a pending proposal is older than the threshold", () => {
    // Stamp the filename date 200 days in the past.
    const old = new Date();
    old.setDate(old.getDate() - 200);
    const stamp = old.toISOString().slice(0, 10);
    writePending(`${stamp}-tackle-task-abcd1234.md`);
    const report = runDoctor({
      only: ["stale-proposals"],
      staleProposalsDays: 90,
    });
    const c = report.checks.find((c) => c.id === "proposals.stale");
    expect(c?.severity).toBe("warn");
    expect(c?.message).toMatch(/90d/);
    expect(c?.message).toMatch(/tackle-task/);
  });
});

describe("substrate doctor — escalation-debt", () => {
  function writeSidecar(scope: string, findings: Array<Record<string, unknown>>): void {
    const dir = join(tmpRoot, "substrate", "audits");
    mkdirSync(dir, { recursive: true });
    const sidecar = {
      scope,
      generatedAt: new Date().toISOString(),
      substrateVersion: "1.0.0",
      results: [
        {
          ruleId: "DUMMY-RULE",
          findings,
        },
      ],
    };
    writeFileSync(
      join(dir, `${scope}-latest.json`),
      JSON.stringify(sidecar, null, 2),
      "utf8",
    );
  }

  it("severity=ok when no audits directory exists", () => {
    const report = runDoctor({ only: ["escalation-debt"] });
    const c = report.checks.find((c) => c.id === "escalation.debt");
    expect(c?.severity).toBe("ok");
  });

  it("severity=ok when sidecars have no critical findings", () => {
    writeSidecar("backend", [
      {
        ruleId: "BE-PY-001",
        severity: "medium",
        message: "soft hit",
      },
    ]);
    const report = runDoctor({ only: ["escalation-debt"] });
    const c = report.checks.find((c) => c.id === "escalation.debt");
    expect(c?.severity).toBe("ok");
    expect(c?.message).toMatch(/no findings stuck/);
  });

  it("severity=warn when a critical finding has been stuck past the threshold", () => {
    const old = new Date();
    old.setDate(old.getDate() - 45);
    writeSidecar("backend", [
      {
        ruleId: "BE-PY-009",
        severity: "critical",
        originalSeverity: "high",
        firstSeenAt: old.toISOString(),
        message: "long-standing critical",
      },
    ]);
    const report = runDoctor({
      only: ["escalation-debt"],
      escalationDebtDays: 30,
    });
    const c = report.checks.find((c) => c.id === "escalation.debt");
    expect(c?.severity).toBe("warn");
    expect(c?.message).toMatch(/BE-PY-009/);
  });
});

describe("substrate doctor — --check filtering", () => {
  it("scoping to one check suppresses the baseline (tooling, config, etc.)", () => {
    const report = runDoctor({ only: ["rules-doc-coverage"] });
    // Only one check should fire when scoped.
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.id).toBe("rules.doc-coverage");
  });

  it("running unscoped includes baseline + v2 checks", () => {
    const report = runDoctor({});
    const ids = report.checks.map((c) => c.id);
    // Spot-check: baseline includes tooling.node; v2 includes rules.doc-coverage.
    expect(ids).toContain("tooling.node");
    expect(ids).toContain("rules.doc-coverage");
    expect(ids).toContain("workflow.coverage");
    expect(ids).toContain("proposals.stale");
    expect(ids).toContain("escalation.debt");
  });

  it("unknown --check names surface as warn entries (not crashes)", () => {
    const report = runDoctor({ only: ["does-not-exist"] });
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.severity).toBe("warn");
    expect(report.checks[0]?.message).toContain("does-not-exist");
  });
});
