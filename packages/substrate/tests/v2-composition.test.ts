/**
 * Tests for v2 composes_findings_of runtime (Primitive 6).
 *
 * Coverage targets:
 *   - findLatestSidecar reads the direct <id>-latest.json
 *   - parseDuration handles 1d / 24h / 90m / 1w / unparseable
 *   - checkComposition: missing dep is stale, fresh dep is not,
 *     beyond-window dep is stale
 *   - reference audit-composite template demonstrates the primitive
 *     and validates against the schema
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkComposition,
  findLatestSidecar,
  parseDuration,
} from "../src/v2/composition.js";
import type { WorkflowManifest } from "../src/v2/types.js";
import { runValidate } from "../src/v2/deterministic/validate-command.js";
import { getTemplatesDir } from "../src/util/paths.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function writeSidecar(
  cwd: string,
  workflowId: string,
  generatedAt: string,
): string {
  const dir = join(cwd, "substrate", "audits");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${workflowId}-latest.json`);
  const payload = {
    schemaVersion: 1,
    generatedAt,
    repoRoot: cwd,
    rulesPath: "RULES.yaml",
    scope: workflowId,
    totalRules: 0,
    executedRules: 0,
    totalFindings: 0,
    findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    rules: [],
    durationMs: 0,
  };
  writeFileSync(path, JSON.stringify(payload));
  return path;
}

describe("parseDuration", () => {
  it("parses seconds/minutes/hours/days/weeks", () => {
    expect(parseDuration("3600s")).toBe(3_600_000);
    expect(parseDuration("90m")).toBe(90 * 60_000);
    expect(parseDuration("24h")).toBe(24 * 60 * 60_000);
    expect(parseDuration("7d")).toBe(7 * 24 * 60 * 60_000);
    expect(parseDuration("1w")).toBe(7 * 24 * 60 * 60_000);
  });

  it("returns null for unparseable input", () => {
    expect(parseDuration("forever")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });
});

describe("findLatestSidecar", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns null when audits dir is missing", () => {
    expect(findLatestSidecar("anything", { cwd: tmp })).toBeNull();
  });

  it("reads <id>-latest.json with generatedAt", () => {
    writeSidecar(tmp, "audit-service", "2026-05-10T12:00:00.000Z");
    const record = findLatestSidecar("audit-service", {
      cwd: tmp,
      now: new Date("2026-05-15T12:00:00.000Z"),
    });
    expect(record).not.toBeNull();
    expect(record!.ageDays).toBe(5);
    expect(record!.generatedAt).toBe("2026-05-10T12:00:00.000Z");
  });
});

describe("checkComposition", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  function manifest(deps: WorkflowManifest["composes_findings_of"]): WorkflowManifest {
    return {
      schema_version: "v2.0",
      id: "x",
      name: "x",
      composes_findings_of: deps,
    };
  }

  it("returns empty result when no composes_findings_of declared", () => {
    const result = checkComposition(manifest(undefined), { cwd: tmp });
    expect(result.dependencies).toEqual([]);
    expect(result.hasStale).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("flags missing dependency as stale", () => {
    const result = checkComposition(
      manifest([{ workflow: "audit-service", "require-fresh-within": "7d" }]),
      { cwd: tmp },
    );
    expect(result.hasStale).toBe(true);
    expect(result.dependencies[0].stale).toBe(true);
    expect(result.dependencies[0].reason).toMatch(/no sidecar/);
  });

  it("flags fresh dependency as not stale", () => {
    writeSidecar(tmp, "audit-service", "2026-05-14T12:00:00.000Z");
    const result = checkComposition(
      manifest([{ workflow: "audit-service", "require-fresh-within": "7d" }]),
      { cwd: tmp, now: new Date("2026-05-15T12:00:00.000Z") },
    );
    expect(result.hasStale).toBe(false);
    expect(result.dependencies[0].stale).toBe(false);
  });

  it("flags dep older than require-fresh-within as stale", () => {
    writeSidecar(tmp, "audit-service", "2026-05-01T12:00:00.000Z");
    const result = checkComposition(
      manifest([{ workflow: "audit-service", "require-fresh-within": "7d" }]),
      { cwd: tmp, now: new Date("2026-05-15T12:00:00.000Z") },
    );
    expect(result.hasStale).toBe(true);
    expect(result.dependencies[0].reason).toMatch(/older than require-fresh-within/);
  });

  it("treats missing require-fresh-within as 'any age fine'", () => {
    writeSidecar(tmp, "audit-service", "2020-01-01T12:00:00.000Z");
    const result = checkComposition(
      manifest([{ workflow: "audit-service" }]),
      { cwd: tmp, now: new Date("2026-05-15T12:00:00.000Z") },
    );
    expect(result.hasStale).toBe(false);
  });
});

describe("audit-composite reference template", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("validates against the workflow schema", () => {
    const src = join(getTemplatesDir(), "workflows", "audit-composite.yaml");
    const dst = join(tmp, "substrate", "workflows", "audit-composite.yaml");
    mkdirSync(join(tmp, "substrate", "workflows"), { recursive: true });
    copyFileSync(src, dst);
    const result = runValidate({ cwd: tmp, quiet: true });
    expect(result.ok).toBe(true);
  });
});
