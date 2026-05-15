/**
 * Integration coverage for v0.5 bridge scaffolding.
 *
 * The cursor bridge is a sibling of the existing claude bridge — both
 * generated from the same dispatch contract, both opt-in via the
 * --bridge flag (or the legacy --with-claude alias). These tests pin
 * the v0.5 contract:
 *
 *   - --bridge claude scaffolds .claude/commands/cadence.md
 *   - --bridge cursor scaffolds .cursor/commands/cadence.md
 *   - --bridge claude,cursor scaffolds both, neither one wiping the other
 *   - --with-claude (legacy) still works as an alias
 *   - Both bridges are independently configurable in cadence.config.json
 *   - doctor reports each enabled bridge separately
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

describe("cadence bridges (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("--bridge claude scaffolds the claude bridge only", () => {
    const result = runCli(
      ["init", "--name", "claude-only", "--short-code", "CL", "--bridge", "claude"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    expect(existsSync(join(tmp, ".claude", "commands", "cadence.md"))).toBe(true);
    expect(existsSync(join(tmp, ".cursor", "commands", "cadence.md"))).toBe(false);

    const config = JSON.parse(
      readFileSync(join(tmp, "cadence.config.json"), "utf8"),
    );
    expect(config.bridges.claude.enabled).toBe(true);
    expect(config.bridges.cursor.enabled).toBe(false);
  });

  it("--bridge cursor scaffolds the cursor bridge only", () => {
    const result = runCli(
      ["init", "--name", "cursor-only", "--short-code", "CU", "--bridge", "cursor"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    expect(existsSync(join(tmp, ".claude", "commands", "cadence.md"))).toBe(false);
    const cursorBridgePath = join(tmp, ".cursor", "commands", "cadence.md");
    expect(existsSync(cursorBridgePath)).toBe(true);

    // Cursor bridge content must include the dispatch table — same
    // contract as the Claude bridge.
    const bridgeContent = readFileSync(cursorBridgePath, "utf8");
    expect(bridgeContent).toContain("/cadence");
    expect(bridgeContent).toContain("npx cadence");
    expect(bridgeContent).toContain("cursor-only"); // PROJECT_NAME replacement

    const config = JSON.parse(
      readFileSync(join(tmp, "cadence.config.json"), "utf8"),
    );
    expect(config.bridges.cursor.enabled).toBe(true);
    expect(config.bridges.claude.enabled).toBe(false);
  });

  it("--bridge claude,cursor scaffolds both bridges in one invocation", () => {
    const result = runCli(
      ["init", "--name", "both", "--short-code", "BO", "--bridge", "claude,cursor"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    expect(existsSync(join(tmp, ".claude", "commands", "cadence.md"))).toBe(true);
    expect(existsSync(join(tmp, ".cursor", "commands", "cadence.md"))).toBe(true);

    const config = JSON.parse(
      readFileSync(join(tmp, "cadence.config.json"), "utf8"),
    );
    expect(config.bridges.claude.enabled).toBe(true);
    expect(config.bridges.cursor.enabled).toBe(true);
  });

  it("--with-claude (legacy) is an alias for --bridge claude", () => {
    const result = runCli(
      ["init", "--name", "legacy", "--short-code", "LG", "--with-claude"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    expect(existsSync(join(tmp, ".claude", "commands", "cadence.md"))).toBe(true);
    expect(existsSync(join(tmp, ".cursor", "commands", "cadence.md"))).toBe(false);
  });

  it("re-running init with the other bridge adds it without wiping the first", () => {
    // Scaffold cursor first, then claude. Both files must end up present.
    runCli(
      ["init", "--name", "additive", "--short-code", "AD", "--bridge", "cursor", "--quiet"],
      { cwd: tmp },
    );
    expect(existsSync(join(tmp, ".cursor", "commands", "cadence.md"))).toBe(true);

    runCli(
      ["init", "--name", "additive", "--short-code", "AD", "--bridge", "claude", "--quiet"],
      { cwd: tmp },
    );
    expect(existsSync(join(tmp, ".cursor", "commands", "cadence.md"))).toBe(true);
    expect(existsSync(join(tmp, ".claude", "commands", "cadence.md"))).toBe(true);
  });

  it("rejects an unknown bridge name with the available list", () => {
    const result = runCli(
      ["init", "--name", "bad", "--short-code", "BD", "--bridge", "vscode"],
      { cwd: tmp },
    );
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/unknown bridge.*vscode/i);
    expect(result.output).toMatch(/claude/);
    expect(result.output).toMatch(/cursor/);
  });

  it("doctor reports both bridges as ok when both are scaffolded", () => {
    runCli(
      [
        "init",
        "--name",
        "dual",
        "--short-code",
        "DU",
        "--bridge",
        "claude,cursor",
        "--quiet",
      ],
      { cwd: tmp },
    );
    const result = runCli(["doctor", "--json"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    const report = JSON.parse(result.stdout);
    interface DoctorCheck {
      id: string;
      severity: string;
    }
    const checks = report.checks as DoctorCheck[];
    const claude = checks.find((c) => c.id === "bridge.claude");
    const cursor = checks.find((c) => c.id === "bridge.cursor");
    expect(claude?.severity).toBe("ok");
    expect(cursor?.severity).toBe("ok");
  });

  it("doctor flags a missing bridge file as an error", () => {
    runCli(
      ["init", "--name", "x", "--short-code", "X", "--bridge", "cursor", "--quiet"],
      { cwd: tmp },
    );
    // Delete the bridge file but leave the config flag enabled — should
    // surface as an error.
    unlinkSync(join(tmp, ".cursor", "commands", "cadence.md"));

    const result = runCli(["doctor", "--json"], { cwd: tmp });
    interface DoctorCheck {
      id: string;
      severity: string;
    }
    const report = JSON.parse(result.stdout);
    const checks = report.checks as DoctorCheck[];
    const missing = checks.find((c) => c.id === "bridge.cursor.missing");
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("error");
  });
});
