import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { AUTO_SUBDIRS } from "../src/util/paths.js";
import { SUBSTRATE_VERSION } from "../src/util/version.js";
import type { SubstrateConfig, SubstrateManifest } from "../src/util/types.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const PROJECT_NAME = "test-project";
const SHORT_CODE = "TST";

describe("runInit", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    process.chdir(tmp);
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("creates the auto/ skeleton with all seven subdirectories", () => {
    const result = runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });

    expect(result.autoDir).toBe(join(tmp, "auto"));
    for (const sub of AUTO_SUBDIRS) {
      const path = join(tmp, "auto", sub);
      expect(existsSync(path), `expected ${sub}/ to exist`).toBe(true);
    }
  });

  it("scaffolds the three default audit instructions", () => {
    runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });

    const expected = ["audit-pre-merge.md", "audit-dependencies.md", "audit-dead-code.md"];
    for (const filename of expected) {
      const path = join(tmp, "auto", "instructions", "main", filename);
      expect(existsSync(path), `expected ${filename}`).toBe(true);
      const contents = readFileSync(path, "utf8");
      expect(contents).toContain("---");
      expect(contents).toContain("command: audit");
    }
  });

  it("writes substrate.config.json with project + shortCode + stacks", () => {
    runInit({
      projectName: PROJECT_NAME,
      shortCode: SHORT_CODE,
      stacks: ["python", "typescript"],
      quiet: true,
    });

    const configPath = join(tmp, "substrate.config.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf8")) as SubstrateConfig;
    expect(config.project.name).toBe(PROJECT_NAME);
    expect(config.project.shortCode).toBe(SHORT_CODE);
    expect(config.stacks).toEqual(["python", "typescript"]);
    expect(config.defaults.audits).toContain("pre-merge");
    expect(config.defaults.audits).toContain("dependencies");
    expect(config.defaults.audits).toContain("dead-code");
    expect(config.version).toBe(SUBSTRATE_VERSION);
  });

  it("writes an empty manifest stub", () => {
    runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });

    const manifestPath = join(tmp, "auto", ".substrate-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SubstrateManifest;
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.substrateVersion).toBe(SUBSTRATE_VERSION);
    expect(manifest.entries).toEqual([]);
  });

  it("does NOT scaffold the Claude bridge by default", () => {
    const result = runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });
    expect(result.claudeBridgeCreated).toBe(false);
    expect(existsSync(join(tmp, ".claude", "commands", "substrate.md"))).toBe(false);
  });

  it("scaffolds the Claude bridge when withClaude is true", () => {
    const result = runInit({
      projectName: PROJECT_NAME,
      shortCode: SHORT_CODE,
      withClaude: true,
      quiet: true,
    });
    expect(result.claudeBridgeCreated).toBe(true);

    const bridgePath = join(tmp, ".claude", "commands", "substrate.md");
    expect(existsSync(bridgePath)).toBe(true);

    const contents = readFileSync(bridgePath, "utf8");
    expect(contents).toContain(PROJECT_NAME);
    expect(contents).toContain(SHORT_CODE);
  });

  it("is idempotent — re-running skips existing files rather than overwriting", () => {
    runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });

    // Mutate a scaffolded file so we can verify it isn't clobbered.
    const auditPath = join(tmp, "auto", "instructions", "main", "audit-pre-merge.md");
    const sentinel = "# USER EDIT — DO NOT OVERWRITE";
    const before = readFileSync(auditPath, "utf8");
    const tampered = before + "\n\n" + sentinel + "\n";
    writeFileSync(auditPath, tampered, "utf8");

    const second = runInit({
      projectName: PROJECT_NAME,
      shortCode: SHORT_CODE,
      quiet: true,
    });
    expect(second.filesSkipped.length).toBeGreaterThan(0);

    const after = readFileSync(auditPath, "utf8");
    expect(after).toContain(sentinel);
  });

  it("derives a sensible shortCode when none provided", () => {
    const result = runInit({ projectName: "fancy-platform", quiet: true });
    expect(result.configCreated).toBe(true);
    const config = JSON.parse(
      readFileSync(join(tmp, "substrate.config.json"), "utf8"),
    ) as SubstrateConfig;
    expect(config.project.shortCode).toMatch(/^[A-Z]{1,3}$/);
  });
});
