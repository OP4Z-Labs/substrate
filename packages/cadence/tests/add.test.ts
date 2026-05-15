import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdd } from "../src/commands/add.js";
import { runInit } from "../src/commands/init.js";
import type { CadenceManifest } from "../src/util/types.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const PROJECT_NAME = "add-test";

describe("runAdd", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    process.chdir(tmp);
    runInit({ projectName: PROJECT_NAME, shortCode: "AT", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("throws a clear error if auto/ is missing", () => {
    const fresh = makeTempDir();
    try {
      process.chdir(fresh);
      expect(() => runAdd({ category: "audit", item: "backend", quiet: true })).toThrow(
        /auto\/ directory not found/,
      );
    } finally {
      removeTempDir(fresh);
    }
  });

  // ----- audit -----
  it("add audit copies the template into auto/instructions/main/", () => {
    const result = runAdd({ category: "audit", item: "backend", quiet: true });
    expect(result.filesCreated).toHaveLength(1);

    const targetPath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    expect(existsSync(targetPath)).toBe(true);
    const contents = readFileSync(targetPath, "utf8");
    expect(contents).toContain("action: backend");
    expect(contents).toContain("command: audit");
  });

  it("add audit throws on an unknown audit name", () => {
    expect(() => runAdd({ category: "audit", item: "does-not-exist", quiet: true })).toThrow(
      /not found/,
    );
  });

  it("add audit preserves an existing file unless --overwrite", () => {
    runAdd({ category: "audit", item: "backend", quiet: true });
    const targetPath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    const SENTINEL = "USER EDIT — do not clobber";
    const updated = readFileSync(targetPath, "utf8") + "\n" + SENTINEL + "\n";
    writeFileSync(targetPath, updated);

    const second = runAdd({ category: "audit", item: "backend", quiet: true });
    expect(second.filesCreated).toHaveLength(0);
    expect(second.filesSkipped).toHaveLength(1);
    expect(readFileSync(targetPath, "utf8")).toContain(SENTINEL);

    const overwritten = runAdd({
      category: "audit",
      item: "backend",
      quiet: true,
      overwrite: true,
    });
    expect(overwritten.filesCreated).toHaveLength(1);
    expect(readFileSync(targetPath, "utf8")).not.toContain(SENTINEL);
  });

  // ----- standard -----
  it("add standard copies a markdown standard from <scope>/<area>", () => {
    const result = runAdd({
      category: "standard",
      item: "backend/architecture",
      quiet: true,
    });
    expect(result.filesCreated).toHaveLength(1);
    const targetPath = join(tmp, "auto", "standards", "backend", "architecture.md");
    expect(existsSync(targetPath)).toBe(true);
    // Match the v1.0 standards-doc title shape (was "Backend Architecture Standards"
    // in the v0.3 stubs; v1.0 dropped the "Standards" suffix on the H1).
    expect(readFileSync(targetPath, "utf8")).toContain("Backend Architecture");
  });

  it("add standard copies the cross-cutting RULES.yaml file", () => {
    const result = runAdd({
      category: "standard",
      item: "cross-cutting/RULES",
      quiet: true,
    });
    expect(result.filesCreated).toHaveLength(1);
    const targetPath = join(tmp, "auto", "standards", "cross-cutting", "RULES.yaml");
    expect(existsSync(targetPath)).toBe(true);
  });

  it("add standard requires a <scope>/<area> shape", () => {
    expect(() => runAdd({ category: "standard", item: "architecture", quiet: true })).toThrow(
      /<scope>\/<area>/,
    );
  });

  // ----- scaffold -----
  it("add scaffold registers an entry in scaffolds.yaml", () => {
    const result = runAdd({ category: "scaffold", item: "package-ts", quiet: true });
    expect(result.filesCreated).toHaveLength(1);
    const registry = readFileSync(join(tmp, "auto", "config", "scaffolds.yaml"), "utf8");
    expect(registry).toContain("- package-ts");
  });

  it("add scaffold is idempotent", () => {
    runAdd({ category: "scaffold", item: "package-ts", quiet: true });
    const second = runAdd({ category: "scaffold", item: "package-ts", quiet: true });
    expect(second.filesCreated).toHaveLength(0);
    expect(second.filesSkipped).toHaveLength(1);
  });

  it("add scaffold rejects unknown templates", () => {
    expect(() =>
      runAdd({ category: "scaffold", item: "no-such-template", quiet: true }),
    ).toThrow(/not found/);
  });

  // ----- workflow -----
  it("add workflow registers and writes a stub", () => {
    const result = runAdd({ category: "workflow", item: "new-service", quiet: true });
    expect(result.filesCreated.length).toBeGreaterThanOrEqual(2); // registry + stub
    expect(
      existsSync(join(tmp, "auto", "instructions", "workflows", "new-service.md")),
    ).toBe(true);
    const registry = readFileSync(join(tmp, "auto", "config", "workflows.yaml"), "utf8");
    expect(registry).toContain("- new-service");
  });

  // ----- command -----
  it("add command writes a stub doc into auto/commands/", () => {
    const result = runAdd({ category: "command", item: "audit", quiet: true });
    expect(result.filesCreated).toHaveLength(1);
    const targetPath = join(tmp, "auto", "commands", "audit.md");
    expect(existsSync(targetPath)).toBe(true);
    const contents = readFileSync(targetPath, "utf8");
    expect(contents).toContain("command: audit");
    expect(contents).toContain("TODO");
  });

  // ----- manifest tracking -----
  it("every add updates auto/.cadence-manifest.json with a tracked entry", () => {
    runAdd({ category: "audit", item: "backend", quiet: true });
    runAdd({ category: "standard", item: "backend/architecture", quiet: true });

    const manifestPath = join(tmp, "auto", ".cadence-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CadenceManifest;
    expect(manifest.entries.length).toBeGreaterThanOrEqual(2);

    const auditEntry = manifest.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(auditEntry?.templateVersion).toBeTruthy();
    expect(auditEntry?.ejected).toBe(false);
  });
});
