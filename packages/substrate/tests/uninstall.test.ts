/**
 * Unit tests for `substrate uninstall`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUninstall } from "../src/commands/uninstall.js";
import { hashContent } from "../src/util/fs.js";
import { SUBSTRATE_VERSION } from "../src/util/version.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("uninstall", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    removeTempDir(tmp);
    vi.restoreAllMocks();
  });

  function seedScaffoldedRepo(): void {
    mkdirSync(join(tmp, "auto"), { recursive: true });
    mkdirSync(join(tmp, "auto", "standards", "backend"), { recursive: true });
    mkdirSync(join(tmp, "auto", "instructions", "main"), { recursive: true });
    mkdirSync(join(tmp, "substrate"), { recursive: true });

    // Write a tracked file + manifest
    const standardPath = join(tmp, "auto", "standards", "backend", "api.md");
    const standardContent = "# API\n";
    writeFileSync(standardPath, standardContent, "utf8");

    const manifest = {
      schemaVersion: 1,
      substrateVersion: SUBSTRATE_VERSION,
      entries: [
        {
          path: "auto/standards/backend/api.md",
          templateVersion: SUBSTRATE_VERSION,
          contentHash: `sha256:${hashContent(standardContent)}`,
          ejected: false,
        },
      ],
    };
    writeFileSync(join(tmp, "auto", ".substrate-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    // Substrate config
    writeFileSync(
      join(tmp, "substrate.config.json"),
      JSON.stringify({ version: "1", project: { name: "test" } }),
      "utf8",
    );
  }

  it("dry-run shows the plan without removing anything", () => {
    seedScaffoldedRepo();
    const result = runUninstall({ cwd: tmp, dryRun: true, quiet: true });
    expect(result.dryRun).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.planned.length).toBeGreaterThan(0);
    // Files still there
    expect(existsSync(join(tmp, "auto", "standards", "backend", "api.md"))).toBe(true);
    expect(existsSync(join(tmp, "substrate.config.json"))).toBe(true);
  });

  it("without --yes is a no-op even after dry-run", () => {
    seedScaffoldedRepo();
    const result = runUninstall({ cwd: tmp, quiet: true });
    expect(result.removed).toEqual([]);
    expect(existsSync(join(tmp, "auto"))).toBe(true);
  });

  it("--yes removes tracked + known-location files", () => {
    seedScaffoldedRepo();
    const result = runUninstall({ cwd: tmp, yes: true, quiet: true });
    expect(result.removed.length).toBeGreaterThan(0);
    expect(existsSync(join(tmp, "auto"))).toBe(false);
    expect(existsSync(join(tmp, "substrate.config.json"))).toBe(false);
    expect(existsSync(join(tmp, "substrate"))).toBe(false);
  });

  it("preserves user-modified files without --force", () => {
    seedScaffoldedRepo();
    // Tamper
    writeFileSync(
      join(tmp, "auto", "standards", "backend", "api.md"),
      "# user-edited\n",
      "utf8",
    );
    const result = runUninstall({ cwd: tmp, yes: true, quiet: true });
    // The user file is preserved
    expect(existsSync(join(tmp, "auto", "standards", "backend", "api.md"))).toBe(true);
    // Even after parent `auto/` may have been targeted, the contained file's directory should remain
    // because the file under it survived.
    // (auto/ was a known-location, but we don't recursively delete user-modified entries.)
    // We expect the api.md to be in skipped
    expect(result.skipped).toContain("auto/standards/backend/api.md");
  });

  it("--force removes user-modified files too", () => {
    seedScaffoldedRepo();
    writeFileSync(
      join(tmp, "auto", "standards", "backend", "api.md"),
      "# user-edited\n",
      "utf8",
    );
    runUninstall({ cwd: tmp, yes: true, force: true, quiet: true });
    expect(existsSync(join(tmp, "auto"))).toBe(false);
  });

  it("removes bridge files in known locations", () => {
    mkdirSync(join(tmp, ".claude", "commands"), { recursive: true });
    writeFileSync(join(tmp, ".claude", "commands", "substrate.md"), "# bridge\n", "utf8");
    const result = runUninstall({ cwd: tmp, yes: true, quiet: true });
    expect(result.removed).toContain(".claude/commands/substrate.md");
    expect(existsSync(join(tmp, ".claude", "commands", "substrate.md"))).toBe(false);
  });

  it("returns an empty plan when the repo has no substrate artefacts", () => {
    const result = runUninstall({ cwd: tmp, dryRun: true, quiet: true });
    expect(result.planned).toHaveLength(0);
  });

  it("JSON output is parseable", () => {
    seedScaffoldedRepo();
    const writes: string[] = [];
    (process.stdout.write as unknown as { mockImplementation: (f: (chunk: unknown) => boolean) => void }).mockImplementation(
      (chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      },
    );
    runUninstall({ cwd: tmp, dryRun: true, json: true });
    // Find the JSON line
    const json = writes.find((w) => w.startsWith("{"));
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json!);
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.planned)).toBe(true);
  });
});

// Use the readFileSync import so noUnusedLocals doesn't complain — we don't
// need it in any specific assertion but importing keeps the symbol live for
// future tests.
void readFileSync;
