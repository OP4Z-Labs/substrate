/**
 * Tests for TI-6 — the 5 new reference workflows.
 *
 * Each new workflow gets:
 *   - validates against the schema
 *   - is discovered by the discoverer
 *   - explains correctly (rendering context + steps)
 *   - has a body.md companion of useful size
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runValidate } from "../src/v2/deterministic/validate-command.js";
import { runExplain } from "../src/v2/deterministic/explain-command.js";
import { discoverWorkflows } from "../src/v2/discoverer.js";
import { getTemplatesDir } from "../src/util/paths.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const NEW_REFERENCE_IDS = [
  "git-review-pre",
  "git-review-deep",
  "commit-and-push",
  "standards-update",
  "audit-security",
];

function seedNewTemplates(targetRoot: string): void {
  const templatesDir = join(getTemplatesDir(), "workflows");
  const dest = join(targetRoot, "substrate", "workflows");
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(templatesDir)) {
    if (
      NEW_REFERENCE_IDS.some(
        (id) => name === `${id}.yaml` || name === `${id}.body.md`,
      )
    ) {
      copyFileSync(join(templatesDir, name), join(dest, name));
    }
  }
}

describe("TI-6 new reference workflows", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    removeTempDir(tmp);
    logSpy.mockRestore();
    errSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("all 5 new manifest + body files exist", () => {
    const templatesDir = join(getTemplatesDir(), "workflows");
    for (const id of NEW_REFERENCE_IDS) {
      expect(
        existsSync(join(templatesDir, `${id}.yaml`)),
        `${id}.yaml should ship`,
      ).toBe(true);
      expect(
        existsSync(join(templatesDir, `${id}.body.md`)),
        `${id}.body.md should ship`,
      ).toBe(true);
    }
  });

  it("all 5 new templates validate against the v2 schema", () => {
    seedNewTemplates(tmp);
    const result = runValidate({ cwd: tmp, quiet: true });
    expect(result.exitCode, JSON.stringify(result.files)).toBe(0);
    expect(result.files.length).toBe(NEW_REFERENCE_IDS.length);
  });

  it("all 5 are discovered", () => {
    seedNewTemplates(tmp);
    const discovery = discoverWorkflows({ cwd: tmp });
    const ids = discovery.workflows.map((w) => w.manifest.id);
    for (const id of NEW_REFERENCE_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("substrate explain renders correctly for each", () => {
    seedNewTemplates(tmp);
    for (const id of NEW_REFERENCE_IDS) {
      const result = runExplain({ workflowId: id, cwd: tmp, quiet: true });
      expect(result.exitCode, `explain ${id}`).toBe(0);
      expect(result.workflowId).toBe(id);
      expect(result.steps.length).toBeGreaterThan(0);
    }
  });

  it("body.md companions are non-trivial in size", () => {
    const templatesDir = join(getTemplatesDir(), "workflows");
    for (const id of NEW_REFERENCE_IDS) {
      const body = require("node:fs").readFileSync(
        join(templatesDir, `${id}.body.md`),
        "utf8",
      ) as string;
      expect(
        body.length,
        `${id}.body.md should be > 300 chars`,
      ).toBeGreaterThan(300);
    }
  });
});
