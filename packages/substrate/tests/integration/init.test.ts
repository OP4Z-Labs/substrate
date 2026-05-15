/**
 * Integration coverage for `substrate init`.
 *
 * Smoke steps covered (from .agent/SMOKE-2026-05-14.md):
 *
 *   - Step 1  : `substrate init --with-claude` in a fresh tmp dir
 *               generates the auto/ skeleton (7 subdirs),
 *               substrate.config.json, the Claude bridge, the manifest
 *               stub, and the v0.1 audit trio. Falls back to
 *               python+typescript when no markers exist.
 *
 *   - Step 11 : Stack detection on a Python-only repo (bare
 *               `pyproject.toml`). `substrate init` should report
 *               `stacks: python (auto-detected)` and the resulting
 *               config has `"stacks": ["python"]` only.
 *
 * Why integration-tested:
 *
 *   The unit suite covers `runInit` programmatically — but only spawning
 *   the binary exercises the actual entry-point guard (`invokedDirectly`),
 *   commander's parsing, and the cwd-injection path. The v0.3 symlink
 *   bug (commit 3995a60) was invisible to the unit suite because no
 *   unit test ever spawned the binary.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

const AUTO_SUBDIRS = [
  "commands",
  "instructions",
  "scripts",
  "config",
  "standards",
  "audits",
  "docs",
] as const;

const DEFAULT_AUDIT_FILES = [
  "audit-pre-merge.md",
  "audit-dependencies.md",
  "audit-dead-code.md",
];

describe("substrate init (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("smoke 1: substrate init --with-claude scaffolds the full v0.1 surface", () => {
    const result = runCli(
      ["init", "--name", "smoke", "--short-code", "SM", "--with-claude", "--quiet"],
      { cwd: tmp },
    );

    // The CLI must exit cleanly. If a symlink-style regression returns,
    // this assertion is the first thing to fire.
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // auto/ skeleton — all seven subdirs.
    for (const sub of AUTO_SUBDIRS) {
      expect(existsSync(join(tmp, "auto", sub)), `expected auto/${sub}/ to exist`).toBe(
        true,
      );
    }

    // substrate.config.json with project + shortCode set.
    const configPath = join(tmp, "substrate.config.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.project.name).toBe("smoke");
    expect(config.project.shortCode).toBe("SM");

    // The Claude bridge.
    const bridgePath = join(tmp, ".claude", "commands", "substrate.md");
    expect(existsSync(bridgePath)).toBe(true);

    // The empty manifest stub.
    const manifestPath = join(tmp, "auto", ".substrate-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.schemaVersion).toBe(1);
    expect(Array.isArray(manifest.entries)).toBe(true);

    // The v0.1 audit trio.
    for (const filename of DEFAULT_AUDIT_FILES) {
      const path = join(tmp, "auto", "instructions", "main", filename);
      expect(existsSync(path), `expected ${filename}`).toBe(true);
    }
  });

  it("smoke 1: no stack flag + no marker files → fallback default (python + typescript)", () => {
    // Reproduces the smoke-test condition: empty tmp dir, no --stack.
    const result = runCli(["init", "--name", "smoke", "--short-code", "SM"], {
      cwd: tmp,
    });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // The fallback-default banner should be visible in stdout. This
    // assertion guards the user-facing "we did NOT detect anything, here
    // is what we picked" contract — vital for transparency.
    expect(result.stdout).toContain("fallback default");

    const config = JSON.parse(readFileSync(join(tmp, "substrate.config.json"), "utf8"));
    expect(config.stacks).toEqual(["python", "typescript"]);
  });

  it("smoke 11: substrate init auto-detects python from bare pyproject.toml", () => {
    // Marker-file setup must happen BEFORE init runs so the detector sees it.
    writeFileSync(join(tmp, "pyproject.toml"), "[tool.poetry]\nname = \"smoke\"\n");

    const result = runCli(
      ["init", "--name", "smoke-python", "--short-code", "SP", "--quiet"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const config = JSON.parse(readFileSync(join(tmp, "substrate.config.json"), "utf8"));
    // The smoke step asserts ONLY python is detected — typescript should
    // not appear in the resulting config.
    expect(config.stacks).toEqual(["python"]);
  });

  it("smoke 11: stack-detection log line surfaces auto-detected", () => {
    // Same setup as the previous test but without --quiet so we can verify
    // the human-readable "auto-detected" banner. This is the user-facing
    // signal that detection ran successfully.
    writeFileSync(join(tmp, "pyproject.toml"), "[tool.poetry]\nname = \"smoke\"\n");

    const result = runCli(["init", "--name", "smoke-python", "--short-code", "SP"], {
      cwd: tmp,
    });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("auto-detected");
    expect(result.stdout).toContain("python");
  });
});
