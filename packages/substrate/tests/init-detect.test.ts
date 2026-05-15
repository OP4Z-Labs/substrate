import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import type { SubstrateConfig } from "../src/util/types.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("runInit with stack auto-detection (v0.3)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    process.chdir(tmp);
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("auto-detects python when pyproject.toml is present", () => {
    writeFileSync(join(tmp, "pyproject.toml"), "[tool.poetry]\nname = \"x\"\n");
    runInit({ quiet: true });
    const config = JSON.parse(
      readFileSync(join(tmp, "substrate.config.json"), "utf8"),
    ) as SubstrateConfig;
    expect(config.stacks).toEqual(["python"]);
    expect(config.defaults.audits).toContain("backend");
    expect(config.defaults.audits).not.toContain("frontend");
    expect(config.defaults.standards).toContain("backend/python");
  });

  it("auto-detects typescript when package.json is present", () => {
    writeFileSync(join(tmp, "package.json"), "{}");
    runInit({ quiet: true });
    const config = JSON.parse(
      readFileSync(join(tmp, "substrate.config.json"), "utf8"),
    ) as SubstrateConfig;
    expect(config.stacks).toEqual(["typescript"]);
    expect(config.defaults.audits).toContain("frontend");
    expect(config.defaults.standards).toContain("frontend/react");
  });

  it("auto-detects mixed python + typescript", () => {
    writeFileSync(join(tmp, "pyproject.toml"), "");
    writeFileSync(join(tmp, "package.json"), "{}");
    runInit({ quiet: true });
    const config = JSON.parse(
      readFileSync(join(tmp, "substrate.config.json"), "utf8"),
    ) as SubstrateConfig;
    expect(config.stacks).toEqual(["python", "typescript"]);
    expect(config.defaults.audits).toContain("backend");
    expect(config.defaults.audits).toContain("frontend");
  });

  it("explicit --stack override beats auto-detection", () => {
    writeFileSync(join(tmp, "pyproject.toml"), "");
    runInit({ stacks: ["typescript"], quiet: true });
    const config = JSON.parse(
      readFileSync(join(tmp, "substrate.config.json"), "utf8"),
    ) as SubstrateConfig;
    expect(config.stacks).toEqual(["typescript"]);
  });

  it("falls back to python+typescript when no markers present", () => {
    runInit({ quiet: true });
    const config = JSON.parse(
      readFileSync(join(tmp, "substrate.config.json"), "utf8"),
    ) as SubstrateConfig;
    expect(config.stacks).toEqual(["python", "typescript"]);
  });

  it("writes the v0.3 knowledge config block by default", () => {
    runInit({ quiet: true });
    const config = JSON.parse(
      readFileSync(join(tmp, "substrate.config.json"), "utf8"),
    ) as SubstrateConfig;
    expect(config.knowledge).toBeDefined();
    expect(config.knowledge?.sources).toContain("docker-compose.yml");
    expect(config.knowledge?.redactPatterns).toContain("SECRET");
  });
});
