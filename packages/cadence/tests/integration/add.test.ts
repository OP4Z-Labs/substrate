/**
 * Integration coverage for `cadence add` subcommands.
 *
 * Smoke steps covered (from .agent/SMOKE-2026-05-14.md):
 *
 *   - Step 5  : `cadence add audit security` writes audit-security.md
 *               under auto/instructions/main/ and records a manifest
 *               entry with sha256 contentHash + templateVersion +
 *               ejected:false. The hash format is the v0.5 upgrade-flow
 *               contract — load-bearing.
 *
 *   - Step 6  : `cadence add standard backend/architecture` writes
 *               auto/standards/backend/architecture.md plus a manifest
 *               entry. The smoke report also noted the `.` delimiter is
 *               rejected with an actionable error — the cleanup pass
 *               recorded the canonical-`/` decision in a comment. The
 *               error-path test pins that intentional behavior.
 *
 *   - Step 7  : `cadence add scaffold package-ts` appends an entry to
 *               auto/config/scaffolds.yaml. As designed, no template
 *               body is copied — `cadence create` pulls from
 *               node_modules at create-time.
 *
 *   - Step 12 : Idempotency. Re-running `cadence add audit security`
 *               preserves the existing file (no clobber), prints the
 *               "already exists" path, and exits 0.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

interface ManifestEntry {
  path: string;
  templateVersion: string;
  contentHash: string;
  ejected: boolean;
}

interface Manifest {
  schemaVersion: number;
  cadenceVersion: string;
  entries: ManifestEntry[];
}

function readManifest(tmp: string): Manifest {
  const path = join(tmp, "auto", ".cadence-manifest.json");
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

describe("cadence add (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    const init = runCli(
      ["init", "--name", "add-int", "--short-code", "AD", "--quiet"],
      { cwd: tmp },
    );
    if (init.status !== 0) {
      throw new Error(
        `Test setup failed: cadence init returned ${init.status}\n${init.stderr}`,
      );
    }
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("smoke 5: cadence add audit security scaffolds + records sha256 in manifest", () => {
    const result = runCli(["add", "audit", "security", "--quiet"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const targetPath = join(tmp, "auto", "instructions", "main", "audit-security.md");
    expect(existsSync(targetPath)).toBe(true);

    // The manifest is the v0.5 upgrade-flow contract — every add must
    // record a sha256-prefixed hash, the cadence version that wrote it,
    // and ejected:false (until user explicitly opts out).
    const manifest = readManifest(tmp);
    const entry = manifest.entries.find((e) =>
      e.path.endsWith("audit-security.md"),
    );
    expect(entry, "expected audit-security entry in manifest").toBeDefined();
    expect(entry?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry?.templateVersion).toBeTruthy();
    expect(entry?.ejected).toBe(false);
  });

  it("smoke 6: cadence add standard backend/architecture writes the doc + manifest entry", () => {
    const result = runCli(
      ["add", "standard", "backend/architecture", "--quiet"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const targetPath = join(tmp, "auto", "standards", "backend", "architecture.md");
    expect(existsSync(targetPath)).toBe(true);

    const manifest = readManifest(tmp);
    const entry = manifest.entries.find((e) =>
      e.path.endsWith(join("backend", "architecture.md")),
    );
    expect(entry).toBeDefined();
    expect(entry?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("smoke 6: cadence add standard rejects the . delimiter with actionable error", () => {
    // The cleanup-pass decision (commit ae7fede): one canonical
    // delimiter `/`, rejected with a hint that names the right form.
    // This pins the intentional behavior so a future "accept both"
    // change is a conscious decision, not an accidental regression.
    const result = runCli(
      ["add", "standard", "backend.architecture", "--quiet"],
      { cwd: tmp },
    );
    expect(result.status).not.toBe(0);
    // The error must include the canonical-form hint.
    expect(result.output).toMatch(/<scope>\/<area>/);
    // And ideally identifies the offending input.
    expect(result.output).toContain("backend.architecture");
  });

  it("smoke 7: cadence add scaffold package-ts registers in scaffolds.yaml", () => {
    const result = runCli(["add", "scaffold", "package-ts", "--quiet"], {
      cwd: tmp,
    });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const registryPath = join(tmp, "auto", "config", "scaffolds.yaml");
    expect(existsSync(registryPath)).toBe(true);
    const registry = readFileSync(registryPath, "utf8");
    expect(registry).toContain("package-ts");

    // The manifest tracks the registry file itself (not a template body
    // — by design, scaffolds.yaml is the user-edited surface).
    const manifest = readManifest(tmp);
    const entry = manifest.entries.find((e) => e.path.endsWith("scaffolds.yaml"));
    expect(entry).toBeDefined();
  });

  it("smoke 12: re-running cadence add audit security preserves the existing file", () => {
    // First add — establishes the file.
    const first = runCli(["add", "audit", "security", "--quiet"], { cwd: tmp });
    expect(first.status, `stderr: ${first.stderr}`).toBe(0);

    const targetPath = join(tmp, "auto", "instructions", "main", "audit-security.md");
    // Tamper with the file so we can detect a clobber.
    const SENTINEL = "USER EDIT — must not be clobbered by re-run";
    const tampered = readFileSync(targetPath, "utf8") + "\n" + SENTINEL + "\n";
    writeFileSync(targetPath, tampered);

    // Second add — must NOT overwrite.
    const second = runCli(["add", "audit", "security"], { cwd: tmp });
    expect(second.status, `stderr: ${second.stderr}`).toBe(0);

    // The user edit must survive.
    const after = readFileSync(targetPath, "utf8");
    expect(after).toContain(SENTINEL);

    // The CLI should signal that it skipped (renderer-specific wording;
    // assert on stable substrings only).
    expect(second.output.toLowerCase()).toMatch(/exist|preserv|skip/);
  });
});
