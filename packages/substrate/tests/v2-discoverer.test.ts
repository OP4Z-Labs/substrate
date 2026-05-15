/**
 * Tests for the v2 Discoverer.
 *
 * Coverage targets:
 *   - empty directory / missing directory → empty result, no throw
 *   - valid manifests parsed + sorted by id
 *   - invalid manifests segregated into `invalidWorkflows` with errors
 *   - `<id>.body.md` sibling is loaded when present
 *   - findWorkflowById / findWorkflowsByKind helpers
 *   - .yml extension is supported (alongside .yaml)
 *   - YAML parse errors surface in invalidWorkflows
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverWorkflows,
  findWorkflowById,
  findWorkflowsByKind,
} from "../src/v2/discoverer.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function writeWorkflow(
  dir: string,
  filename: string,
  content: string,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

describe("discoverWorkflows", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns empty when substrate/workflows/ doesn't exist", () => {
    const result = discoverWorkflows({ cwd: tmp });
    expect(result.workflows).toEqual([]);
    expect(result.invalidWorkflows).toEqual([]);
    expect(result.workflowsDir).toBe(join(tmp, "substrate", "workflows"));
  });

  it("returns empty when the directory exists but contains no yaml", () => {
    mkdirSync(join(tmp, "substrate", "workflows"), { recursive: true });
    const result = discoverWorkflows({ cwd: tmp });
    expect(result.workflows).toEqual([]);
    expect(result.invalidWorkflows).toEqual([]);
  });

  it("parses valid manifests and sorts by id", () => {
    const dir = join(tmp, "substrate", "workflows");
    writeWorkflow(
      dir,
      "zebra.yaml",
      "schema_version: v2.0\nid: zebra\nname: Zebra\n",
    );
    writeWorkflow(
      dir,
      "alpha.yaml",
      "schema_version: v2.0\nid: alpha\nname: Alpha\n",
    );
    const result = discoverWorkflows({ cwd: tmp });
    expect(result.workflows.map((w) => w.manifest.id)).toEqual(["alpha", "zebra"]);
    expect(result.invalidWorkflows).toEqual([]);
  });

  it("loads the .body.md sibling when present", () => {
    const dir = join(tmp, "substrate", "workflows");
    writeWorkflow(dir, "ok.yaml", "schema_version: v2.0\nid: ok\nname: OK\n");
    writeFileSync(join(dir, "ok.body.md"), "# Body content\n");
    const result = discoverWorkflows({ cwd: tmp });
    expect(result.workflows.length).toBe(1);
    expect(result.workflows[0].body).toContain("Body content");
    expect(result.workflows[0].bodyPath).toBe(join(dir, "ok.body.md"));
  });

  it("returns null for body when the sibling is missing", () => {
    const dir = join(tmp, "substrate", "workflows");
    writeWorkflow(dir, "x.yaml", "schema_version: v2.0\nid: x\nname: X\n");
    const result = discoverWorkflows({ cwd: tmp });
    expect(result.workflows[0].body).toBeNull();
    expect(result.workflows[0].bodyPath).toBeNull();
  });

  it("segregates schema-invalid manifests with error details", () => {
    const dir = join(tmp, "substrate", "workflows");
    writeWorkflow(dir, "good.yaml", "schema_version: v2.0\nid: good\nname: G\n");
    writeWorkflow(
      dir,
      "bad.yaml",
      "schema_version: v3.0\nid: BadCase\nname: B\n",
    );
    const result = discoverWorkflows({ cwd: tmp });
    expect(result.workflows.map((w) => w.manifest.id)).toEqual(["good"]);
    expect(result.invalidWorkflows.length).toBe(1);
    expect(result.invalidWorkflows[0].manifestPath).toBe(join(dir, "bad.yaml"));
    expect(result.invalidWorkflows[0].errors.length).toBeGreaterThan(0);
  });

  it("captures YAML parse errors as parse-error in invalidWorkflows", () => {
    const dir = join(tmp, "substrate", "workflows");
    writeWorkflow(dir, "broken.yaml", "id: [unclosed\n");
    const result = discoverWorkflows({ cwd: tmp });
    expect(result.workflows).toEqual([]);
    expect(result.invalidWorkflows.length).toBe(1);
    expect(result.invalidWorkflows[0].errors[0].keyword).toBe("parse-error");
  });

  it("accepts .yml in addition to .yaml", () => {
    const dir = join(tmp, "substrate", "workflows");
    writeWorkflow(dir, "alt.yml", "schema_version: v2.0\nid: alt\nname: A\n");
    const result = discoverWorkflows({ cwd: tmp });
    expect(result.workflows.map((w) => w.manifest.id)).toEqual(["alt"]);
  });
});

describe("findWorkflowById", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns the matching workflow", () => {
    const dir = join(tmp, "substrate", "workflows");
    writeWorkflow(dir, "x.yaml", "schema_version: v2.0\nid: x\nname: X\n");
    const found = findWorkflowById("x", { cwd: tmp });
    expect(found?.manifest.id).toBe("x");
  });

  it("returns null when not found", () => {
    expect(findWorkflowById("missing", { cwd: tmp })).toBeNull();
  });
});

describe("findWorkflowsByKind", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("filters by manifest.kind", () => {
    const dir = join(tmp, "substrate", "workflows");
    writeWorkflow(
      dir,
      "a.yaml",
      "schema_version: v2.0\nid: a\nname: A\nkind: audit\n",
    );
    writeWorkflow(
      dir,
      "r.yaml",
      "schema_version: v2.0\nid: r\nname: R\nkind: review\n",
    );
    writeWorkflow(dir, "n.yaml", "schema_version: v2.0\nid: n\nname: N\n");
    const audits = findWorkflowsByKind("audit", { cwd: tmp });
    expect(audits.map((w) => w.manifest.id)).toEqual(["a"]);
  });
});
