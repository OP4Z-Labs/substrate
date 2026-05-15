/**
 * Integration coverage for the substrate GitHub Action (v0.8).
 *
 * Validates:
 *   - action.yml schema matches GitHub's action-metadata expectations
 *   - dist/action/index.js exists and is syntactically valid Node JS
 *   - Action runs end-to-end against a fixture working-directory,
 *     producing the documented report file + stdout output
 *
 * The action shells out to `npx substrate@<version>` for the real run,
 * which would hit npm. To keep CI offline-friendly, the action test
 * here overrides PATH so a local-built substrate shim is reached first;
 * the action sees a passing run without touching the network.
 *
 * Out of scope: actually running on GitHub-hosted runners. That's the
 * `.github/workflows/substrate-action-test.yml` dogfood workflow.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = packages/substrate/tests/integration → up 4 to monorepo root.
const MONOREPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const ACTION_YML = join(MONOREPO_ROOT, "action.yml");
const ACTION_JS = join(MONOREPO_ROOT, "dist", "action", "index.js");

describe("substrate GitHub Action", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("action.yml exists at the repo root with the documented inputs", () => {
    expect(existsSync(ACTION_YML), `${ACTION_YML} must ship at repo root`).toBe(
      true,
    );
    const meta = parseYaml(readFileSync(ACTION_YML, "utf8"));
    expect(meta.name).toBe("Substrate");
    expect(meta.runs.using).toBe("node20");
    expect(meta.runs.main).toBe("dist/action/index.js");
    // Required + optional inputs documented in the brief.
    expect(meta.inputs.command).toBeDefined();
    expect(meta.inputs.command.required).toBe(true);
    expect(meta.inputs["working-directory"]).toBeDefined();
    expect(meta.inputs["fail-on"]).toBeDefined();
    // Outputs the action contracts to surface.
    expect(meta.outputs["exit-code"]).toBeDefined();
    expect(meta.outputs["report-path"]).toBeDefined();
  });

  it("dist/action/index.js exists and parses as JavaScript", () => {
    expect(existsSync(ACTION_JS), `${ACTION_JS} must be committed`).toBe(true);
    // Syntactic check via `node --check`. Doesn't execute the file.
    const result = spawnSync(process.execPath, ["--check", ACTION_JS], {
      encoding: "utf8",
    });
    expect(result.status, `node --check stderr: ${result.stderr}`).toBe(0);
  });

  it("action exits 0 + writes report when the wrapped substrate command succeeds", () => {
    // Stub `npx` on PATH so the action's `npx -y @op4z/substrate@... <args>`
    // resolves to our shim. The shim prints "stub stdout" to stdout
    // and exits 0 — proves the action wires inputs through correctly.
    const shimDir = join(tmp, "shim");
    mkdirSync(shimDir, { recursive: true });
    const shimPath = join(shimDir, "npx");
    writeFileSync(
      shimPath,
      `#!/usr/bin/env bash\necho "stub stdout: $@"\nexit 0\n`,
      "utf8",
    );
    chmodSync(shimPath, 0o755);

    const workdir = join(tmp, "work");
    mkdirSync(workdir);
    const githubOutput = join(tmp, "github-output.txt");
    writeFileSync(githubOutput, "", "utf8");

    const result = spawnSync(process.execPath, [ACTION_JS], {
      cwd: workdir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
        INPUT_COMMAND: "doctor --json",
        INPUT_WORKING_DIRECTORY: workdir,
        INPUT_VERSION: "0.8.0",
        INPUT_FAIL_ON: "error",
        GITHUB_OUTPUT: githubOutput,
      },
    });
    expect(result.status, `action stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);

    // Report file should land in the working directory.
    const reportPath = join(workdir, "substrate-report.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.command).toBe("doctor --json");
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("stub stdout");

    // GitHub Actions outputs: appended to GITHUB_OUTPUT in heredoc form.
    const outputContent = readFileSync(githubOutput, "utf8");
    expect(outputContent).toContain("exit-code");
    expect(outputContent).toContain("report-path");
  });

  it("action exits non-zero when wrapped substrate command fails (fail-on=error)", () => {
    const shimDir = join(tmp, "shim");
    mkdirSync(shimDir, { recursive: true });
    const shimPath = join(shimDir, "npx");
    writeFileSync(
      shimPath,
      `#!/usr/bin/env bash\necho "stub error" >&2\nexit 1\n`,
      "utf8",
    );
    chmodSync(shimPath, 0o755);

    const workdir = join(tmp, "work");
    mkdirSync(workdir);

    const result = spawnSync(process.execPath, [ACTION_JS], {
      cwd: workdir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
        INPUT_COMMAND: "audit --type backend",
        INPUT_WORKING_DIRECTORY: workdir,
        INPUT_VERSION: "0.8.0",
        INPUT_FAIL_ON: "error",
        GITHUB_OUTPUT: join(tmp, "out.txt"),
      },
    });
    expect(result.status).not.toBe(0);
    // Report still gets written even on failure.
    const reportPath = join(workdir, "substrate-report.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.exitCode).toBe(1);
  });

  it("action exits 0 when fail-on=none, regardless of underlying substrate exit code", () => {
    const shimDir = join(tmp, "shim");
    mkdirSync(shimDir, { recursive: true });
    const shimPath = join(shimDir, "npx");
    writeFileSync(
      shimPath,
      `#!/usr/bin/env bash\necho "ignored failure" >&2\nexit 2\n`,
      "utf8",
    );
    chmodSync(shimPath, 0o755);

    const workdir = join(tmp, "work");
    mkdirSync(workdir);
    const result = spawnSync(process.execPath, [ACTION_JS], {
      cwd: workdir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
        INPUT_COMMAND: "audit --list",
        INPUT_WORKING_DIRECTORY: workdir,
        INPUT_FAIL_ON: "none",
        GITHUB_OUTPUT: join(tmp, "out.txt"),
      },
    });
    expect(result.status).toBe(0);
  });

  it("rejects an unknown fail-on value with exit 2 (input validation)", () => {
    const workdir = join(tmp, "work");
    mkdirSync(workdir);
    const result = spawnSync(process.execPath, [ACTION_JS], {
      cwd: workdir,
      encoding: "utf8",
      env: {
        ...process.env,
        INPUT_COMMAND: "audit --list",
        INPUT_FAIL_ON: "panic",
        GITHUB_OUTPUT: join(tmp, "out.txt"),
      },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/Invalid.*fail-on/i);
  });

  it("rejects when the required `command` input is missing", () => {
    const workdir = join(tmp, "work");
    mkdirSync(workdir);
    const result = spawnSync(process.execPath, [ACTION_JS], {
      cwd: workdir,
      encoding: "utf8",
      env: {
        ...process.env,
        // INPUT_COMMAND deliberately missing.
        INPUT_FAIL_ON: "error",
        GITHUB_OUTPUT: join(tmp, "out.txt"),
      },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/command/);
  });
});
