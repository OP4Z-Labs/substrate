/**
 * Tests for `substrate validate` and the underlying JSON-Schema validator.
 *
 * Coverage targets:
 *  - schema accepts well-formed manifests (all 11 primitive shapes
 *    we can express in B1)
 *  - schema rejects each major class of error with a recognizable error
 *  - CLI returns exit code 0 / 1 / 2 per spec
 *  - --json shape is stable for CI consumers
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runValidate } from "../src/v2/deterministic/validate-command.js";
import {
  validateManifest,
  validateManifestFile,
} from "../src/v2/validate.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("validateManifest", () => {
  it("accepts the minimum valid manifest (id + name + schema_version)", () => {
    const result = validateManifest({
      schema_version: "v2.0",
      id: "audit-service",
      name: "Audit Service",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a fully-populated manifest with all sections", () => {
    const result = validateManifest({
      schema_version: "v2.0",
      id: "tackle-task",
      name: "Tackle a task end-to-end",
      kind: "task-tackle",
      authors: ["beau"],
      last_updated: "2026-05-15",
      trigger: ["manual-command", { schedule: { cron: "0 9 * * MON" } }],
      when: {
        "files-changed-any": ["apps/backend/**"],
        "branch-pattern": "^(feat|fix)/.*",
      },
      context: {
        standards: ["backend/python.md"],
        memory: { types: ["feedback"], scope: "backend", tags: ["api"] },
        rules: ["BE-PY-*"],
      },
      composes_findings_of: [
        { workflow: "audit-security", "require-fresh-within": "1d" },
      ],
      hooks: { "cross-cutting": ["auto-emit-sidecar"] },
      steps: [
        { id: "research", type: "prompt", prompt: "Research the task." },
        { id: "build", type: "invoke-deterministic", run: "npm run build" },
        { id: "tests", type: "invoke-sub-workflow", workflow: "run-tests" },
      ],
      followups: [{ if: "gate == pass", suggest: "Run commit-and-push." }],
      acceptance: { exit_codes: { pass: 0, conditional: 1, fail: 2 } },
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an id with capital letters", () => {
    const result = validateManifest({
      schema_version: "v2.0",
      id: "AuditService",
      name: "x",
    });
    expect(result.ok).toBe(false);
    const idError = result.errors.find((e) => e.path === "/id");
    expect(idError, "expected /id pattern violation, got: " + JSON.stringify(result.errors))
      .toBeDefined();
    expect(idError?.keyword).toBe("pattern");
  });

  it("rejects an unknown schema_version", () => {
    const result = validateManifest({
      schema_version: "v3.0",
      id: "x",
      name: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "/schema_version")).toBe(true);
  });

  it("rejects a step with an unrecognized type", () => {
    const result = validateManifest({
      schema_version: "v2.0",
      id: "x",
      name: "x",
      steps: [{ id: "bad", type: "bogus" }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "/steps/0/type")).toBe(true);
  });

  it("requires `run` for invoke-deterministic steps", () => {
    const result = validateManifest({
      schema_version: "v2.0",
      id: "x",
      name: "x",
      steps: [{ id: "missing-run", type: "invoke-deterministic" }],
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.keyword === "required" && JSON.stringify(e.params).includes("run")),
      "expected required:run violation, got: " + JSON.stringify(result.errors),
    ).toBe(true);
  });

  it("requires `prompt` for prompt steps", () => {
    const result = validateManifest({
      schema_version: "v2.0",
      id: "x",
      name: "x",
      steps: [{ id: "missing-prompt", type: "prompt" }],
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.keyword === "required" && JSON.stringify(e.params).includes("prompt")),
    ).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const result = validateManifest({
      schema_version: "v2.0",
      id: "x",
      name: "x",
      bogus_field: 42,
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.keyword === "additionalProperties",
      ),
      "expected additionalProperties violation: " + JSON.stringify(result.errors),
    ).toBe(true);
  });
});

describe("validateManifestFile", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("validates a YAML file on disk", () => {
    const path = join(tmp, "valid.yaml");
    writeFileSync(
      path,
      "schema_version: v2.0\nid: audit-service\nname: Audit Service\n",
    );
    const result = validateManifestFile(path);
    expect(result.ok).toBe(true);
    expect(result.parsed?.id).toBe("audit-service");
  });

  it("returns file-not-found when the path doesn't exist", () => {
    const result = validateManifestFile(join(tmp, "missing.yaml"));
    expect(result.ok).toBe(false);
    expect(result.errors[0].keyword).toBe("file-not-found");
    expect(result.parsed).toBeNull();
  });

  it("returns parse-error on malformed YAML", () => {
    const path = join(tmp, "broken.yaml");
    writeFileSync(path, "id: [unclosed\n");
    const result = validateManifestFile(path);
    expect(result.ok).toBe(false);
    expect(result.errors[0].keyword).toBe("parse-error");
  });
});

describe("runValidate (CLI command)", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    removeTempDir(tmp);
    logSpy.mockRestore();
  });

  it("returns exit 0 when manifest is valid", () => {
    const path = join(tmp, "ok.yaml");
    writeFileSync(
      path,
      "schema_version: v2.0\nid: ok\nname: ok\n",
    );
    const result = runValidate({ path, quiet: true });
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("returns exit 1 when schema validation fails", () => {
    const path = join(tmp, "bad.yaml");
    writeFileSync(path, "schema_version: v2.0\nid: Bad-Id\nname: x\n");
    const result = runValidate({ path, quiet: true });
    expect(result.exitCode).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("returns exit 2 when file is not found", () => {
    const result = runValidate({ path: join(tmp, "missing.yaml"), quiet: true });
    expect(result.exitCode).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("walks substrate/workflows/ when no path is provided", () => {
    const workflowsDir = join(tmp, "substrate", "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, "a.yaml"),
      "schema_version: v2.0\nid: a\nname: A\n",
    );
    writeFileSync(
      join(workflowsDir, "b.yaml"),
      "schema_version: v2.0\nid: b\nname: B\n",
    );
    const result = runValidate({ cwd: tmp, quiet: true });
    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(2);
  });

  it("returns exit 2 when substrate/workflows/ doesn't exist", () => {
    const result = runValidate({ cwd: tmp, quiet: true });
    expect(result.exitCode).toBe(2);
  });
});
