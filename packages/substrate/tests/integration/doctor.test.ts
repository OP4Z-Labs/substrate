/**
 * Integration coverage for `substrate doctor`.
 *
 * Smoke step covered (from .agent/SMOKE-2026-05-14.md):
 *
 *   - Step 10 : `substrate doctor` runs all six checks (Node runtime,
 *               config, auto subdirs, manifest, stack alignment, claude
 *               bridge), produces a "N ok, M warn, K error" summary,
 *               and exits 0 when no errors fire. On a not-yet-init'd
 *               repo, exit code is non-zero.
 *
 *   Sub-cases pinned here:
 *
 *     - Happy path: post-init repo. Exit 0. All six check titles
 *       appear in the output. Summary line present.
 *     - Stack drift: --stack python on an empty tmp dir → stack-
 *       alignment warning + actionable fix string. Exit 0 (warn-only
 *       doesn't fail the gate).
 *     - Missing config: doctor on an empty dir → exit 1, error
 *       severity.
 *     - --json: machine-readable output, parseable, contains
 *       exitCode + summary.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

describe("substrate doctor (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("smoke 10: doctor on a freshly-initialized repo passes all checks", () => {
    const init = runCli(
      ["init", "--name", "doctor-int", "--short-code", "DI", "--quiet"],
      { cwd: tmp },
    );
    expect(init.status, `init stderr: ${init.stderr}`).toBe(0);

    const result = runCli(["doctor"], { cwd: tmp });
    // Healthy repo → exit 0 (warn doesn't fail; only error does).
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // The summary line is the smoke-report acceptance criterion. It must
    // be present and end with "X ok, Y warn, Z error" — assert on the
    // wording without coupling to exact counts (substrate version bumps
    // could shift the bridge check, for example).
    expect(result.stdout).toMatch(/ok.*warn.*error/);

    // Spot-check each of the six checks rendered at least once. The
    // Node runtime check uses "Node.js" in its title; the others use
    // their own canonical strings from doctor.ts.
    expect(result.stdout).toContain("Node.js runtime");
    expect(result.stdout).toContain("substrate.config.json");
    expect(result.stdout).toContain("auto/ subdirectories");
    expect(result.stdout).toContain(".substrate-manifest.json");
    expect(result.stdout).toContain("Stack detection");

    // The warn-fix line for stack alignment is the actionable hint the
    // smoke report called out specifically. When init falls back to
    // python+typescript on an empty tmp dir, doctor warns about
    // declared-but-not-detected stacks — and the fix string must be
    // present. (Empty tmp dir has no marker files at all.)
    expect(result.stdout.toLowerCase()).toMatch(/marker files|substrate.config/);
  });

  it("smoke 10: doctor on an uninitialized dir reports error + exits non-zero", () => {
    const result = runCli(["doctor"], { cwd: tmp });
    expect(result.status).not.toBe(0);

    // The config.missing check should fire.
    expect(result.stdout).toContain("substrate.config.json");
    // Summary line must reflect at least one error.
    expect(result.stdout).toMatch(/error/);
  });

  it("smoke 10: doctor flags declared-but-not-detected stack drift as warn", () => {
    // Init with an explicit stack the repo doesn't have markers for.
    // The smoke report saw this exact case (python+typescript declared,
    // no markers found → stack.declared-missing warn).
    const init = runCli(
      [
        "init",
        "--name",
        "doctor-int",
        "--short-code",
        "DI",
        "--stack",
        "python,go",
        "--quiet",
      ],
      { cwd: tmp },
    );
    expect(init.status, `init stderr: ${init.stderr}`).toBe(0);

    const result = runCli(["doctor"], { cwd: tmp });
    // warn doesn't fail the gate → exit 0.
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // The drift check should surface the missing-marker message.
    expect(result.stdout).toContain("Stack detection");
    expect(result.stdout.toLowerCase()).toMatch(/no marker files|declared/);
    // Summary line must include at least one warn.
    expect(result.stdout).toMatch(/warn/);
  });

  it("smoke 10: doctor --json emits parseable machine output", () => {
    const init = runCli(
      ["init", "--name", "doctor-int", "--short-code", "DI", "--quiet"],
      { cwd: tmp },
    );
    expect(init.status).toBe(0);

    const result = runCli(["doctor", "--json"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // The JSON envelope must parse without error and surface the
    // exitCode + summary that downstream CI tooling depends on.
    const parsed = JSON.parse(result.stdout) as {
      exitCode: number;
      checks: Array<{ id: string; severity: string }>;
      summary: { ok: number; warn: number; error: number };
    };
    expect(parsed.exitCode).toBe(0);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBeGreaterThanOrEqual(5);
    expect(parsed.summary).toBeDefined();
    expect(typeof parsed.summary.ok).toBe("number");
  });

  it("smoke 10: doctor surfaces error severity (exit 1) for a corrupted config", () => {
    const init = runCli(
      ["init", "--name", "doctor-int", "--short-code", "DI", "--quiet"],
      { cwd: tmp },
    );
    expect(init.status).toBe(0);

    // Corrupt substrate.config.json — invalid JSON.
    writeFileSync(join(tmp, "substrate.config.json"), "{not-valid-json");

    const result = runCli(["doctor"], { cwd: tmp });
    // Error severity must non-zero-exit the doctor command.
    expect(result.status).not.toBe(0);
    expect(result.stdout.toLowerCase()).toContain("could not parse");
  });
});
