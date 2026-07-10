/**
 * U7 — doctor rule-health checks, each PROVEN to fire on a planted defect.
 *
 * The census requirement (DoD): every doctor check must be shown to go red on
 * a real defect. The `escalation-debt` check shipped reading `report.results`
 * when the shape is `report.rules`, so its loop body never ran and it reported
 * "no debt" unconditionally — a dead check inside the tool this program leans
 * on. These tests plant a defect per check and assert it fires, so a check
 * cannot silently rot the way that one did.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _internals } from "../src/commands/doctor.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function writeRules(root: string, body: string): void {
  mkdirSync(join(root, "substrate"), { recursive: true });
  writeFileSync(join(root, "substrate", "RULES.yaml"), body, "utf8");
}

describe("doctor: escalation-debt actually fires (RC6)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => removeTempDir(tmp));

  it("warns on a finding stuck at critical past the debt window", () => {
    const auditsDir = join(tmp, "substrate", "audits");
    mkdirSync(auditsDir, { recursive: true });
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    // The sidecar shape is report.rules[].findings[] — the exact shape the old
    // check read the wrong key of.
    writeFileSync(
      join(auditsDir, "all-latest.json"),
      JSON.stringify({
        scope: "all",
        rules: [{ ruleId: "BE-DB-003", findings: [{ ruleId: "BE-DB-003", severity: "critical", firstSeenAt: old }] }],
      }),
      "utf8",
    );
    const results = _internals.checkEscalationDebt(tmp, 30);
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("warn");
    expect(results[0]!.message).toContain("critical");
  });

  it("stays ok when the sidecar has no stuck findings", () => {
    const auditsDir = join(tmp, "substrate", "audits");
    mkdirSync(auditsDir, { recursive: true });
    writeFileSync(
      join(auditsDir, "all-latest.json"),
      JSON.stringify({ scope: "all", rules: [{ ruleId: "OK", findings: [] }] }),
      "utf8",
    );
    expect(_internals.checkEscalationDebt(tmp, 30)[0]!.severity).toBe("ok");
  });
});

describe("doctor: rules-health fires on each planted defect", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => removeTempDir(tmp));

  function byId(root: string, id: string) {
    return _internals.checkRulesHealth(root).find((c) => c.id === id)!;
  }

  it("warns on a shell detector type", () => {
    writeRules(tmp, ["rules:", "  - id: S", "    title: s", "    severity: high", "    detector: { type: shell, command: mypy }"].join("\n"));
    expect(byId(tmp, "rules.executable-types").severity).toBe("warn");
  });

  it("errors on a missing script detector file", () => {
    writeRules(tmp, ["rules:", "  - id: SC", "    title: sc", "    severity: high", "    detector: { type: script, path: substrate/detectors/nope.mjs }"].join("\n"));
    expect(byId(tmp, "rules.script-paths").severity).toBe("error");
  });

  it("warns on a stale non-glob ripgrep path", () => {
    writeRules(tmp, ["rules:", "  - id: LP", "    title: lp", "    severity: high", "    detector: { type: ripgrep, pattern: x, paths: ['apps/does-not-exist'] }"].join("\n"));
    expect(byId(tmp, "rules.literal-paths").severity).toBe("warn");
  });

  it("does NOT flag a glob path as a stale literal path", () => {
    writeRules(tmp, ["rules:", "  - id: G", "    title: g", "    severity: high", "    detector: { type: ripgrep, pattern: x, paths: ['apps/backend/*/tests'] }"].join("\n"));
    // Glob resolution is a runtime concern (surfaces via audit errors[]), not a
    // doctor static check — so this must stay ok, not a false positive.
    expect(byId(tmp, "rules.literal-paths").severity).toBe("ok");
  });

  it("warns on a loader warning (unknown detector key)", () => {
    writeRules(tmp, ["rules:", "  - id: K", "    title: k", "    severity: high", "    detector: { type: ripgrep, pattern: x, patern: oops }"].join("\n"));
    expect(byId(tmp, "rules.load-warnings").severity).toBe("warn");
  });

  it("is all-ok on a clean registry with an existing script file", () => {
    mkdirSync(join(tmp, "substrate", "detectors"), { recursive: true });
    writeFileSync(join(tmp, "substrate", "detectors", "ok.mjs"), "export default () => [];\n", "utf8");
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeRules(
      tmp,
      [
        "rules:",
        "  - id: R1",
        "    title: a ripgrep rule",
        "    severity: high",
        "    detector: { type: ripgrep, pattern: TODO, paths: ['src'] }",
        "  - id: R2",
        "    title: a script rule",
        "    severity: low",
        "    detector: { type: script, path: substrate/detectors/ok.mjs }",
      ].join("\n"),
    );
    const results = _internals.checkRulesHealth(tmp);
    expect(results.every((c) => c.severity === "ok")).toBe(true);
  });
});
