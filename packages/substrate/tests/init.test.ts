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

  // Regression tests for SMOKE-2026-05-15 finding 3: `substrate init`
  // must scaffold the v2 layout so a fresh consumer can immediately
  // invoke v2 commands (`audit`, `validate`, `hooks list`, etc.) without
  // having to copy templates out of node_modules.
  describe("v2 layout scaffold", () => {
    it("creates substrate/ with the v2 layout (workflows, hooks, doc-checks, RULES, empty dirs)", () => {
      const result = runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });

      expect(result.substrateDir).toBe(join(tmp, "substrate"));
      expect(existsSync(join(tmp, "substrate"))).toBe(true);

      // Workflows + hooks + doc-checks each get the bundled reference manifests.
      const expectedWorkflows = [
        "audit-composite.yaml",
        "audit-package.yaml",
        "audit-service.yaml",
        "new-service.yaml",
        "tackle-task.yaml",
        "weekly-proposal-walk.yaml",
      ];
      for (const name of expectedWorkflows) {
        expect(
          existsSync(join(tmp, "substrate", "workflows", name)),
          `workflow ${name}`,
        ).toBe(true);
      }

      const expectedHooks = [
        "auto-drift-detect.yaml",
        "auto-emit-sidecar.yaml",
        "auto-propose-tasks.yaml",
        "auto-update-trend.yaml",
      ];
      for (const name of expectedHooks) {
        expect(
          existsSync(join(tmp, "substrate", "hooks", name)),
          `hook ${name}`,
        ).toBe(true);
      }

      // RULES.yaml at the substrate/ root so `substrate audit` runs immediately.
      expect(existsSync(join(tmp, "substrate", "RULES.yaml"))).toBe(true);

      // Empty runtime dirs are pre-created so commands that write into them
      // don't fail with ENOENT on a fresh install.
      for (const sub of [
        "sessions",
        "audits",
        "standards",
        "proposals/pending",
        "proposals/applied",
        "proposals/rejected",
      ]) {
        expect(
          existsSync(join(tmp, "substrate", sub)),
          `expected substrate/${sub}/`,
        ).toBe(true);
      }

      // filesCreated should report at least one workflow + one hook + one doc-check + RULES.
      expect(result.v2FilesCreated.length).toBeGreaterThan(0);
      expect(result.v2FilesCreated).toContain("RULES.yaml");
    });

    it("does NOT overwrite user-modified v2 files on re-run", () => {
      runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });

      const wfPath = join(tmp, "substrate", "workflows", "tackle-task.yaml");
      const sentinel = "# USER EDIT — DO NOT OVERWRITE\nid: tackle-task\n";
      writeFileSync(wfPath, sentinel, "utf8");

      const rulesPath = join(tmp, "substrate", "RULES.yaml");
      const rulesSentinel = "# USER RULES\nrules: []\n";
      writeFileSync(rulesPath, rulesSentinel, "utf8");

      const second = runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });

      expect(readFileSync(wfPath, "utf8")).toBe(sentinel);
      expect(readFileSync(rulesPath, "utf8")).toBe(rulesSentinel);
      // The skipped list should mention both files we tampered with.
      const skipped = second.v2FilesSkipped.join(" ");
      expect(skipped).toContain("tackle-task.yaml");
      expect(skipped).toContain("RULES.yaml");
    });

    it("does not write a knowledge-sources.yaml stub (absent file is a first-class state)", () => {
      runInit({ projectName: PROJECT_NAME, shortCode: SHORT_CODE, quiet: true });
      expect(
        existsSync(join(tmp, "substrate", "knowledge-sources.yaml")),
        "init should not scaffold knowledge-sources.yaml",
      ).toBe(false);
    });
  });
});
