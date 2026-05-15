import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultAuditsFor,
  defaultStandardsFor,
  detectStacks,
} from "../src/util/detect.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("detectStacks", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns no stacks when no markers exist", () => {
    const result = detectStacks(tmp);
    expect(result.stacks).toEqual([]);
    expect(result.mixed).toBe(false);
    expect(result.evidence).toEqual({});
  });

  it("detects python from pyproject.toml", () => {
    writeFileSync(join(tmp, "pyproject.toml"), "[tool.poetry]\nname = \"x\"\n");
    const result = detectStacks(tmp);
    expect(result.stacks).toEqual(["python"]);
    expect(result.evidence.python).toBe("pyproject.toml");
    expect(result.mixed).toBe(false);
  });

  it("detects typescript from package.json", () => {
    writeFileSync(join(tmp, "package.json"), "{}");
    const result = detectStacks(tmp);
    expect(result.stacks).toEqual(["typescript"]);
    expect(result.evidence.typescript).toBe("package.json");
  });

  it("detects go from go.mod", () => {
    writeFileSync(join(tmp, "go.mod"), "module example.com/foo\n");
    const result = detectStacks(tmp);
    expect(result.stacks).toEqual(["go"]);
  });

  it("detects rust from Cargo.toml", () => {
    writeFileSync(join(tmp, "Cargo.toml"), "[package]\nname = \"x\"\n");
    const result = detectStacks(tmp);
    expect(result.stacks).toEqual(["rust"]);
  });

  it("returns mixed when multiple stacks are present", () => {
    writeFileSync(join(tmp, "pyproject.toml"), "");
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, "go.mod"), "module x");
    const result = detectStacks(tmp);
    expect(result.stacks).toEqual(["python", "typescript", "go"]);
    expect(result.mixed).toBe(true);
  });

  it("falls back to alternate python markers (requirements.txt)", () => {
    writeFileSync(join(tmp, "requirements.txt"), "fastapi\n");
    const result = detectStacks(tmp);
    expect(result.stacks).toEqual(["python"]);
    expect(result.evidence.python).toBe("requirements.txt");
  });
});

describe("defaultAuditsFor", () => {
  it("includes the universal set for any stack", () => {
    const audits = defaultAuditsFor(["python"]);
    for (const universal of ["pre-merge", "dependencies", "dead-code", "security"]) {
      expect(audits).toContain(universal);
    }
  });

  it("includes backend audits for python", () => {
    const audits = defaultAuditsFor(["python"]);
    expect(audits).toContain("backend");
    expect(audits).toContain("service-consistency");
  });

  it("includes frontend audit for typescript", () => {
    const audits = defaultAuditsFor(["typescript"]);
    expect(audits).toContain("frontend");
  });

  it("includes package audit for both python and typescript", () => {
    expect(defaultAuditsFor(["python"])).toContain("package");
    expect(defaultAuditsFor(["typescript"])).toContain("package");
  });

  it("returns deduplicated list when multiple stacks share audits", () => {
    const audits = defaultAuditsFor(["python", "typescript"]);
    const unique = new Set(audits);
    expect(audits.length).toBe(unique.size);
  });
});

describe("defaultStandardsFor", () => {
  it("includes cross-cutting and ops standards for any stack", () => {
    const stds = defaultStandardsFor(["python"]);
    expect(stds).toContain("cross-cutting/rules");
    expect(stds).toContain("operations/runbooks");
    expect(stds).toContain("infrastructure/docker");
  });

  it("adds backend standards for python", () => {
    const stds = defaultStandardsFor(["python"]);
    expect(stds).toContain("backend/architecture");
    expect(stds).toContain("backend/python");
  });

  it("adds frontend standards for typescript", () => {
    const stds = defaultStandardsFor(["typescript"]);
    expect(stds).toContain("frontend/react");
    expect(stds).toContain("frontend/typescript");
  });

  it("does NOT include backend/python for go-only stack", () => {
    const stds = defaultStandardsFor(["go"]);
    expect(stds).toContain("backend/architecture");
    expect(stds).not.toContain("backend/python");
  });
});
