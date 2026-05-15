/**
 * Integration coverage for `substrate upgrade` (v0.5).
 *
 * Exercises the spawned CLI binary so contract changes to the
 * upgrade UX surface here (not just in the unit harness that talks
 * to `runUpgrade` directly).
 *
 * The interactive `--apply` flow is hard to drive from a subprocess
 * without a TTY, so those scenarios live in the unit suite where the
 * programmatic `resolveChoice` hook is available. CLI tests stay on
 * the read-only branches (`--check`, `--dry-run`) which are the most
 * common day-to-day usage anyway.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

describe("substrate upgrade (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    const init = runCli(
      ["init", "--name", "upgrade-int", "--short-code", "UP", "--quiet"],
      { cwd: tmp },
    );
    if (init.status !== 0) {
      throw new Error(`init failed: ${init.stderr}`);
    }
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("--check reports drift without writing anything", () => {
    // Scaffold an audit, then edit it to create drift.
    runCli(["add", "audit", "backend", "--quiet"], { cwd: tmp });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    const userContent = "# my edited audit\n\nLocally customized.\n";
    writeFileSync(filePath, userContent);

    const result = runCli(["upgrade", "--check"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // Plan header must appear; drift must be flagged.
    expect(result.stdout).toMatch(/Upgrade plan/);
    expect(result.stdout).toMatch(/modified/);
    expect(result.stdout).toContain("audit-backend.md");

    // No writes: file unchanged.
    expect(readFileSync(filePath, "utf8")).toBe(userContent);
  });

  it("--dry-run behaves like --check (no writes)", () => {
    runCli(["add", "audit", "backend", "--quiet"], { cwd: tmp });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    const userContent = "# my edited audit\n";
    writeFileSync(filePath, userContent);

    const result = runCli(["upgrade", "--dry-run"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Upgrade plan/);
    expect(readFileSync(filePath, "utf8")).toBe(userContent);
  });

  it("--check on an unmodified scaffold reports no drift", () => {
    runCli(["add", "audit", "backend", "--quiet"], { cwd: tmp });
    // No edits — file is identical to template.
    const result = runCli(["upgrade", "--check"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    // Default audit-backend should classify as either up-to-date OR
    // auto-update (depending on whether the bundled template has
    // moved since scaffold time — in v0.5 they're identical so it's
    // up-to-date).
    expect(result.stdout).toMatch(/up-to-date|auto-update/);
    // The plan summary always mentions "modified: 0"; what we don't want
    // is a per-entry line of the form `modified <path>`.
    expect(result.stdout).not.toMatch(/modified\s+auto\//);
    // The counts line should show modified: 0 explicitly.
    expect(result.stdout).toMatch(/modified:\s*0/);
  });

  it("rejects when neither --check nor --apply is passed", () => {
    runCli(["add", "audit", "backend", "--quiet"], { cwd: tmp });
    const result = runCli(["upgrade"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/--check.*--apply|--apply.*--check/);
  });

  it("rejects when both --check and --apply are passed", () => {
    runCli(["add", "audit", "backend", "--quiet"], { cwd: tmp });
    const result = runCli(["upgrade", "--check", "--apply"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/mutually exclusive/);
  });

  it("shows ejected entries as skipped", () => {
    // Scaffold, then directly edit the manifest to mark ejected.
    runCli(["add", "audit", "backend", "--quiet"], { cwd: tmp });
    const manifestPath = join(tmp, "auto", ".substrate-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    interface MockEntry {
      path: string;
      ejected: boolean;
    }
    const target = (manifest.entries as MockEntry[]).find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(target).toBeDefined();
    target!.ejected = true;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const result = runCli(["upgrade", "--check"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    // Per-entry rendering shows "ejected" for opted-out files.
    expect(result.stdout).toMatch(/ejected.*audit-backend\.md/s);
  });

  it("reports missing files when the user deletes a scaffolded entry", () => {
    runCli(["add", "audit", "backend", "--quiet"], { cwd: tmp });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    expect(existsSync(filePath)).toBe(true);
    // Manually delete.
    unlinkSync(filePath);

    const result = runCli(["upgrade", "--check"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/missing.*audit-backend\.md/s);
  });
});
