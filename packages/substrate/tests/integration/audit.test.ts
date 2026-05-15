/**
 * Integration coverage for `substrate audit`.
 *
 * Smoke steps covered (from .agent/SMOKE-2026-05-14.md):
 *
 *   - Step 2 : `substrate audit --list` enumerates the scaffolded audits
 *              AND surfaces the bundled catalog (post-cleanup behavior,
 *              commit cbff723). Default output includes both an
 *              "Enabled (scaffolded)" section and an "Available
 *              (catalog)" section.
 *
 *   - Step 3 : `substrate audit --type pre-merge` returns a structured
 *              stub: instruction path, description, "stub" banner.
 *              Exit 0. The stub-message wording must reference v0.5
 *              (the executor), NOT v0.3 — per the cleanup pass that
 *              corrected the stale "ships in v0.3" string (commit
 *              e504ce2).
 *
 *   - Step 4 : `substrate audit --type backend` against a fresh init
 *              fails with an actionable error (not-scaffolded). The
 *              error must list what IS available — without that hint
 *              the user has no remediation path.
 *
 * Note on smoke step 4 framing: the smoke report calls this
 * "expected fail". The integration test asserts the failure shape
 * (non-zero exit + actionable error string), so it PASSES when the
 * CLI's not-scaffolded handling works correctly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

describe("substrate audit (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    // Every audit test needs an initialized repo first.
    const init = runCli(
      ["init", "--name", "audit-int", "--short-code", "AI", "--quiet"],
      { cwd: tmp },
    );
    if (init.status !== 0) {
      throw new Error(
        `Test setup failed: substrate init returned ${init.status}\n${init.stderr}`,
      );
    }
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("smoke 2: audit --list enumerates scaffolded audits + bundled catalog", () => {
    // The post-cleanup contract (commit cbff723): default output has
    // both "Enabled (scaffolded)" and "Available (catalog)" sections.
    // This is what the smoke report's DEGRADED finding asked for — the
    // cleanup pass fixed it; this test guards against regression.
    const result = runCli(["audit", "--list"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // The v0.1 trio scaffolded by init must be in the enabled section.
    expect(result.stdout).toContain("Enabled (scaffolded)");
    expect(result.stdout).toContain("pre-merge");
    expect(result.stdout).toContain("dependencies");
    expect(result.stdout).toContain("dead-code");

    // The bundled catalog must be visible. Spot-check three known
    // templates that aren't scaffolded by default (backend, frontend,
    // security ship in the catalog but not in the v0.1 init trio).
    expect(result.stdout).toContain("Available (catalog)");
    expect(result.stdout).toContain("backend");
    expect(result.stdout).toContain("frontend");
    expect(result.stdout).toContain("security");

    // The hints under each section guide users to the next action.
    expect(result.stdout).toContain("substrate audit --type");
    expect(result.stdout).toContain("substrate add audit");
  });

  it("smoke 2: audit --list --json emits the structured envelope", () => {
    // The JSON shape is a downstream contract for any substrate-aware
    // tooling. Asserting on parsable output + the two top-level keys
    // pins the shape without coupling to the renderer.
    const result = runCli(["audit", "--list", "--json"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const parsed = JSON.parse(result.stdout) as {
      enabled: Array<{ type: string }>;
      catalog: Array<{ type: string; scaffolded: boolean }>;
    };
    expect(Array.isArray(parsed.enabled)).toBe(true);
    expect(Array.isArray(parsed.catalog)).toBe(true);
    expect(parsed.catalog.length).toBeGreaterThan(parsed.enabled.length);

    const preMerge = parsed.catalog.find((c) => c.type === "pre-merge");
    expect(preMerge?.scaffolded).toBe(true);
    const backend = parsed.catalog.find((c) => c.type === "backend");
    expect(backend?.scaffolded).toBe(false);
  });

  it("smoke 3: audit --type pre-merge returns a structured stub", () => {
    const result = runCli(["audit", "--type", "pre-merge"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // The stub must clearly identify itself as a stub.
    expect(result.stdout).toContain("stub");
    expect(result.stdout).toContain("Findings:");
    expect(result.stdout).toContain("pre-merge");
  });

  it("smoke 3: audit --type stub message references v0.5 (not the current version)", () => {
    // The cleanup pass corrected this string from "ships in v0.3" to
    // "coming in v0.5" (commit e504ce2). Pin the forward-looking
    // reference so future stale messages get caught.
    const result = runCli(["audit", "--type", "pre-merge"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("v0.5");
    // Negative assertion: the old stale string must NOT appear. If a
    // future regression brings it back, this fails loudly.
    expect(result.stdout).not.toContain("ships in v0.3");
  });

  it("smoke 4: audit --type backend fails with actionable error when not scaffolded", () => {
    // The init trio is pre-merge / dependencies / dead-code only. The
    // smoke report flagged "backend" as EXPECTED FAIL because the user
    // has to `substrate add audit backend` first. The integration test
    // pins both the failure mode (non-zero exit) AND the error message
    // shape (lists what IS available).
    const result = runCli(["audit", "--type", "backend"], { cwd: tmp });
    expect(result.status).not.toBe(0);

    // Error must mention the missing audit name and the canonical path.
    expect(result.output).toMatch(/not found/i);
    expect(result.output).toContain("audit-backend.md");

    // Error must list what's available so the user can recover without
    // re-running `substrate audit --list`.
    expect(result.output).toMatch(/available/i);
    expect(result.output).toContain("pre-merge");
  });
});
